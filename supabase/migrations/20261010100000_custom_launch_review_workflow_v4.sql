BEGIN;
-- Additive discussion and explicit revision replacement. No executable bytes or approvals are rewritten.
CREATE TABLE programmable_custom_launch_api_v1.custom_launch_review_workflow_v4 (
 singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL CHECK(version=4)
);
INSERT INTO programmable_custom_launch_api_v1.custom_launch_review_workflow_v4 VALUES(true,4);
ALTER TABLE programmable_custom_launch_api_v1.custom_launch_review_workflow_v4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE programmable_custom_launch_api_v1.custom_launch_review_workflow_v4 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON programmable_custom_launch_api_v1.custom_launch_review_workflow_v4 FROM PUBLIC,anon,authenticated,service_role,programmable_custom_launch_api_runtime;
CREATE OR REPLACE FUNCTION programmable_custom_launch_api_v1.custom_launch_review_json_v1(id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('schemaVersion','programmable.custom-launch-manual-review.v1','reviewId',review_id,
 'subjectHash',subject_hash,'chainId',chain_id,'controller',controller,
 'state',CASE WHEN state='approved' AND expires_at<=clock_timestamp() THEN 'expired' ELSE state END,
 'revision',revision,'submittedAt',submitted_at,'approvedAt',approved_at,'expiresAt',expires_at,'reason',reason,
 'requiresRepack',signing_window_seconds=3600 AND launch_requested_at IS NULL AND (expires_at IS NULL OR expires_at<>approved_at+INTERVAL '1 hour'),
 'reviewDueAt',submitted_at+INTERVAL '24 hours',
 'reviewOverdue',state='pending' AND submitted_at+INTERVAL '24 hours'<=clock_timestamp(),
 'discussion',COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',d.revision,'createdAt',d.decided_at,'author',CASE WHEN d.decision->>'operation'='reply' THEN 'applicant' ELSE 'reviewer' END,'message',d.decision->>'message','links',COALESCE(d.decision->'links','[]'::jsonb)) ORDER BY d.revision) FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d WHERE d.review_id=id AND d.decision->>'operation' IN('request_information','reply')),'[]'::jsonb),
 'tradeChecks',(SELECT d.decision->'report' FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d WHERE d.review_id=id AND d.decision->>'operation'='record_checks' ORDER BY d.revision DESC LIMIT 1),
 'supersededBy',(SELECT d.decision->'replacement' FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d WHERE d.review_id=id AND d.decision->>'operation'='replace' ORDER BY d.revision DESC LIMIT 1),
 'launchRequestedAt',CASE WHEN expires_at=approved_at+INTERVAL '1 hour' THEN approved_at ELSE launch_requested_at END,
 'launchDeadline',CASE WHEN expires_at=approved_at+INTERVAL '1 hour' THEN expires_at
   WHEN launch_requested_at IS NOT NULL THEN LEAST(expires_at,launch_requested_at+make_interval(secs=>signing_window_seconds)) ELSE NULL END)
 FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 WHERE review_id=id
$$;

CREATE OR REPLACE FUNCTION programmable_custom_launch_api_v1.custom_launch_review_api_v1(operation text,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r programmable_custom_launch_api_v1.custom_launch_reviews_v1%ROWTYPE; decision_time timestamptz; replacement programmable_custom_launch_api_v1.custom_launch_reviews_v1%ROWTYPE; event jsonb;
BEGIN
 IF operation='prepareEthereum' THEN RETURN to_jsonb(programmable_custom_launch_api_v1.custom_launch_review_prepare_ethereum_v1((p->>'launchId')::uuid,(p->>'revision')::integer,p->'request')); END IF;
 IF operation='read' THEN RETURN programmable_custom_launch_api_v1.custom_launch_review_read_v1(p->>'chainId',(p->>'launchId')::uuid); END IF;
 IF current_user='programmable_custom_launch_v4_api' OR NOT pg_has_role(session_user,'programmable_custom_launch_api_runtime','MEMBER') THEN
 RAISE EXCEPTION 'REVIEW_ADMIN_ROLE_REQUIRED' USING ERRCODE='42501'; END IF;
 IF operation IN('ownerRead','request_information','reply','replace','record_checks') THEN
 SELECT r0.* INTO r FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 r0
 WHERE (p ? 'reviewId' AND r0.review_id=(p->>'reviewId')::uuid)
 OR (NOT p ? 'reviewId' AND EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_bindings_v1 b
 WHERE b.review_id=r0.review_id AND b.chain_id=p->>'chainId' AND b.launch_id=(p->>'launchId')::uuid)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
 IF operation IN('ownerRead','reply') OR (operation='replace' AND NOT p ? 'reviewer') THEN
   IF NOT EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.wallet_bindings w
     JOIN programmable_custom_launch_api_v1.principals q USING(principal_id)
     WHERE w.principal_id=r.principal_id AND lower(w.wallet_address)=lower(p->>'ownerWallet')
     AND w.revoked_at IS NULL AND q.status='active') THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
   IF p ? 'credential' AND (p->'credential'->>'principalId' IS DISTINCT FROM r.principal_id::text
     OR (CASE WHEN r.chain_id='1' THEN EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.api_credentials c
     JOIN programmable_custom_launch_api_v1.wallet_bindings w ON w.wallet_binding_id=c.wallet_binding_id AND w.principal_id=c.principal_id
     JOIN programmable_custom_launch_api_v1.principals q ON q.principal_id=c.principal_id
     JOIN programmable_custom_launch_api_v1.api_credential_scopes s ON s.credential_id=c.credential_id AND s.scope='custom-launch:create'
     WHERE c.key_id=p->'credential'->>'keyId' AND c.principal_id=r.principal_id AND c.revoked_at IS NULL
       AND c.expires_at>clock_timestamp() AND '1'=ANY(c.allowed_chain_ids) AND w.revoked_at IS NULL AND q.status='active'
       AND lower(w.wallet_address)=lower(p->>'ownerWallet'))
     ELSE programmable_custom_launch_api_v1.credential_allows_custom_launch_v4('wallet-api-key',p->'credential'->>'keyId',r.principal_id,r.chain_id,'custom-launch:create') END) IS NOT TRUE)
     THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
 ELSE
   IF (p->'reviewer'->>'privyUserId' ~ '^did:privy:') IS NOT TRUE
     OR (p->'reviewer'->>'walletAddress' ~ '^0x[0-9a-fA-F]{40}$') IS NOT TRUE
     THEN RAISE EXCEPTION 'REVIEW_DECISION_INVALID'; END IF;
 END IF;
 IF operation='ownerRead' THEN RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id); END IF;
 IF r.subject_hash IS DISTINCT FROM p->>'subjectHash' THEN RAISE EXCEPTION 'REVIEW_SUBJECT_CONFLICT'; END IF;
 IF (p->>'revision' ~ '^[1-9][0-9]{0,8}$') IS NOT TRUE THEN RAISE EXCEPTION 'REVIEW_DECISION_INVALID'; END IF;
 event:=p||jsonb_build_object('operation',operation);
 IF r.revision<>(p->>'revision')::integer THEN
   IF EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d WHERE d.review_id=r.review_id
     AND d.revision=(p->>'revision')::integer+1 AND (d.decision-'replacement')=event)
     THEN RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id); END IF;
   RAISE EXCEPTION 'REVIEW_DECISION_CONFLICT';
 END IF;
 IF r.state='approved' OR r.launch_requested_at IS NOT NULL OR EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d
   WHERE d.review_id=r.review_id AND d.decision->>'operation'='replace') THEN RAISE EXCEPTION 'REVIEW_DECISION_CONFLICT'; END IF;
 IF operation='replace' THEN
   SELECT * INTO replacement FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 n
   WHERE n.review_id=(p->>'replacementReviewId')::uuid AND n.principal_id=r.principal_id AND n.chain_id=r.chain_id
     AND n.controller=r.controller AND n.submitted_at>r.submitted_at AND n.review_id<>r.review_id FOR SHARE;
   IF NOT FOUND OR EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d
     WHERE d.review_id=replacement.review_id AND d.decision->>'operation'='replace') THEN RAISE EXCEPTION 'REVIEW_REPLACEMENT_INVALID'; END IF;
   event:=event||jsonb_build_object('replacement',jsonb_build_object('reviewId',replacement.review_id,'launchId',replacement.first_launch_id));
   UPDATE programmable_custom_launch_api_v1.custom_launch_reviews_v1 SET state='rejected',revision=revision+1,
     reason='Replaced by launch request '||replacement.first_launch_id::text||'. Continue with that request.' WHERE review_id=r.review_id;
 ELSIF operation='record_checks' THEN
   IF jsonb_typeof(p->'report') IS DISTINCT FROM 'object' OR octet_length((p->'report')::text)>16000
     OR p->'report'->>'schemaVersion' IS DISTINCT FROM 'programmable.review-trade-report.v4'
     OR p->'report'->>'reviewId' IS DISTINCT FROM r.review_id::text OR p->'report'->>'subjectHash' IS DISTINCT FROM r.subject_hash
     OR p->'report'->>'chainId' IS DISTINCT FROM r.chain_id THEN RAISE EXCEPTION 'REVIEW_TRADE_REPORT_INVALID'; END IF;
   UPDATE programmable_custom_launch_api_v1.custom_launch_reviews_v1 SET revision=revision+1 WHERE review_id=r.review_id;
 ELSE
   IF jsonb_typeof(p->'message') IS DISTINCT FROM 'string' OR length(btrim(p->>'message')) NOT BETWEEN 1 AND 12000
     OR jsonb_typeof(p->'links') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'links')>3
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'links') link WHERE jsonb_typeof(link)<>'string' OR length(link#>>'{}')>2048 OR (link#>>'{}') !~ '^https://[^/@?#]+(?:[/:?#]|$)')
     OR (SELECT count(*) FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d
       WHERE d.review_id=r.review_id AND d.decision->>'operation' IN('request_information','reply'))>=64
     THEN RAISE EXCEPTION 'REVIEW_MESSAGE_INVALID'; END IF;
   UPDATE programmable_custom_launch_api_v1.custom_launch_reviews_v1 SET revision=revision+1,
     reason=CASE WHEN operation='request_information' THEN left(p->>'message',2000) ELSE reason END WHERE review_id=r.review_id;
 END IF;
 INSERT INTO programmable_custom_launch_api_v1.custom_launch_review_decisions_v1(review_id,revision,decision) VALUES(r.review_id,r.revision+1,event);
 RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id);
 END IF;
 IF operation='start' THEN
 IF p->>'chainId' NOT IN('1','4663') OR (p->>'ownerWallet' ~ '^0x[0-9a-fA-F]{40}$') IS NOT TRUE THEN
   RAISE EXCEPTION 'REVIEW_START_INVALID' USING ERRCODE='22023'; END IF;
 -- Match the issuer's plan-then-review lock order.
 IF p->>'chainId'='4663' THEN
   PERFORM 1 FROM programmable_custom_launch_api_v1.custom_launch_plans_v1 WHERE plan_id=(p->>'launchId')::uuid FOR UPDATE;
 END IF;
 SELECT r0.* INTO r FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 r0
 JOIN programmable_custom_launch_api_v1.custom_launch_review_bindings_v1 b USING(review_id)
 WHERE b.chain_id=p->>'chainId' AND b.launch_id=(p->>'launchId')::uuid
 AND EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.wallet_bindings w
   JOIN programmable_custom_launch_api_v1.principals q USING(principal_id)
   WHERE w.principal_id=r0.principal_id AND lower(w.wallet_address)=lower(p->>'ownerWallet')
   AND w.revoked_at IS NULL AND q.status='active') FOR UPDATE OF r0;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
 IF p ? 'credential' AND (p->'credential'->>'principalId' IS DISTINCT FROM r.principal_id::text
   OR (CASE WHEN r.chain_id='1' THEN EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.api_credentials c
     JOIN programmable_custom_launch_api_v1.wallet_bindings w ON w.wallet_binding_id=c.wallet_binding_id AND w.principal_id=c.principal_id
     JOIN programmable_custom_launch_api_v1.principals q ON q.principal_id=c.principal_id
     JOIN programmable_custom_launch_api_v1.api_credential_scopes s ON s.credential_id=c.credential_id AND s.scope='custom-launch:create'
     WHERE c.key_id=p->'credential'->>'keyId' AND c.principal_id=r.principal_id AND c.revoked_at IS NULL
       AND c.expires_at>clock_timestamp() AND '1'=ANY(c.allowed_chain_ids) AND w.revoked_at IS NULL AND q.status='active'
       AND lower(w.wallet_address)=lower(p->>'ownerWallet'))
     ELSE programmable_custom_launch_api_v1.credential_allows_custom_launch_v4('wallet-api-key',p->'credential'->>'keyId',r.principal_id,p->>'chainId','custom-launch:create') END) IS NOT TRUE) THEN
   RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
 IF r.state<>'approved' OR r.approved_at>clock_timestamp() OR r.expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'MANUAL_REVIEW_REQUIRED' USING ERRCODE='55000'; END IF;
 -- Repeated starts are idempotent. Neither the approval nor an issued transaction is extended.
 IF r.launch_requested_at IS NOT NULL OR r.expires_at=r.approved_at+INTERVAL '1 hour' THEN
   RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id); END IF;
 IF r.signing_window_seconds<>86400 THEN RAISE EXCEPTION 'REVIEW_REPLAN_REQUIRED'; END IF;
 decision_time:=date_trunc('milliseconds',clock_timestamp());
 UPDATE programmable_custom_launch_api_v1.custom_launch_reviews_v1 SET launch_requested_at=decision_time WHERE review_id=r.review_id;
 IF p->>'chainId'='4663' THEN PERFORM programmable_custom_launch_api_v1.custom_launch_review_prepare_plan_v1((p->>'launchId')::uuid); END IF;
 UPDATE programmable_custom_launch_api_v1.launch_lifecycle_jobs_v3 j SET state='queued',generation=generation+1,
 next_attempt_at=decision_time,work_expires_at=LEAST(r.expires_at,decision_time+make_interval(secs=>r.signing_window_seconds)),updated_at=decision_time
 FROM programmable_custom_launch_api_v1.custom_launch_review_bindings_v1 b,programmable_custom_launch_api_v1.launch_requests l
 WHERE b.review_id=r.review_id AND b.chain_id='1' AND j.request_id=b.launch_id AND l.request_id=b.launch_id
 AND l.status IN('received','validating','pending_review','action_required');
 RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id);
 END IF;
 IF operation='acceptedHash' THEN RETURN (SELECT to_jsonb(accepted_request_hash) FROM programmable_custom_launch_api_v1.custom_launch_review_bindings_v1 WHERE chain_id=p->>'chainId' AND launch_id=(p->>'launchId')::uuid); END IF;
 IF operation='list' THEN RETURN (SELECT COALESCE(jsonb_agg(item ORDER BY submitted_at DESC),'[]'::jsonb) FROM (
 SELECT submitted_at,(programmable_custom_launch_api_v1.custom_launch_review_json_v1(review_id)-'discussion')||jsonb_build_object('discussion',CASE WHEN jsonb_array_length(programmable_custom_launch_api_v1.custom_launch_review_json_v1(review_id)->'discussion')>0 THEN jsonb_build_array(programmable_custom_launch_api_v1.custom_launch_review_json_v1(review_id)->'discussion'->-1) ELSE '[]'::jsonb END,'launchId',first_launch_id,'requestSummary',jsonb_build_object('schemaVersion',request_payload->'schemaVersion','projectMetadata',request_payload->'projectMetadata','profile',request_payload->'launchProfile','executor',request_payload->'executor','actionCount',CASE WHEN jsonb_typeof(request_payload->'actions')='array' THEN jsonb_array_length(request_payload->'actions') ELSE NULL END)) item
 FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 ORDER BY submitted_at DESC LIMIT 100) q); END IF;
 IF operation='detail' THEN
 SELECT * INTO r FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 WHERE review_id=(p->>'reviewId')::uuid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id)||jsonb_build_object(
 'launchId',r.first_launch_id,'request',r.request_payload,'technicalStatus',CASE WHEN r.chain_id='1' THEN
 (SELECT jsonb_build_object('status',status,'errorCode',error_code,'result',result_payload) FROM programmable_custom_launch_api_v1.launch_requests WHERE request_id=r.first_launch_id)
 ELSE (SELECT jsonb_build_object('status',status,'preflight',preflight) FROM programmable_custom_launch_api_v1.custom_launch_plans_v1 WHERE plan_id=r.first_launch_id) END);
 END IF;
 IF operation IS DISTINCT FROM 'decide' OR (p->>'decision' IN('approve','reject')) IS NOT TRUE
 OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(p->>'reason')>2000
 OR (p->>'revision' ~ '^[1-9][0-9]{0,8}$') IS NOT TRUE
 OR (p->>'subjectHash' ~ '^sha256:[0-9a-f]{64}$') IS NOT TRUE
 OR (p->'reviewer'->>'privyUserId' ~ '^did:privy:') IS NOT TRUE OR (p->'reviewer'->>'walletAddress' ~ '^0x[0-9a-fA-F]{40}$') IS NOT TRUE THEN
 RAISE EXCEPTION 'REVIEW_DECISION_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM programmable_custom_launch_api_v1.custom_launch_reviews_v1 WHERE review_id=(p->>'reviewId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
 IF r.subject_hash IS DISTINCT FROM p->>'subjectHash' THEN RAISE EXCEPTION 'REVIEW_SUBJECT_CONFLICT'; END IF;
 IF r.revision<>(p->>'revision')::integer THEN
 IF EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 WHERE review_id=r.review_id AND revision=(p->>'revision')::integer+1 AND decision=p) THEN RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id); END IF;
 RAISE EXCEPTION 'REVIEW_DECISION_CONFLICT'; END IF;
 IF EXISTS(SELECT 1 FROM programmable_custom_launch_api_v1.custom_launch_review_decisions_v1 d WHERE d.review_id=r.review_id AND d.decision->>'operation'='replace') THEN RAISE EXCEPTION 'REVIEW_SUPERSEDED'; END IF;
 IF p->>'decision'='approve' AND r.signing_window_seconds<>86400 THEN RAISE EXCEPTION 'REVIEW_REPLAN_REQUIRED'; END IF;
 IF r.state='approved' AND r.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'REVIEW_ALREADY_APPROVED'; END IF;
 decision_time:=date_trunc('milliseconds',clock_timestamp());
 UPDATE programmable_custom_launch_api_v1.custom_launch_reviews_v1 SET
 state=CASE WHEN p->>'decision'='approve' THEN 'approved' ELSE 'rejected' END,revision=revision+1,
 approved_at=CASE WHEN p->>'decision'='approve' THEN decision_time ELSE NULL END,
 expires_at=CASE WHEN p->>'decision'='approve' THEN decision_time+INTERVAL '24 hours' ELSE NULL END,
 launch_requested_at=NULL,
 reviewer_subject=p->'reviewer'->>'privyUserId',reviewer_wallet=lower(p->'reviewer'->>'walletAddress'),reason=p->>'reason' WHERE review_id=r.review_id;
 INSERT INTO programmable_custom_launch_api_v1.custom_launch_review_decisions_v1(review_id,revision,decision) VALUES(r.review_id,r.revision+1,p);
 -- Wake unsigned Ethereum work only. Waiting for an administrator never spends
 -- the submitted permit's lifetime or consumes a background retry budget.
 IF p->>'decision'='approve' THEN
 UPDATE programmable_custom_launch_api_v1.launch_lifecycle_jobs_v3 j SET state='queued',generation=generation+1,
 next_attempt_at=decision_time,work_expires_at=decision_time+INTERVAL '24 hours',updated_at=decision_time
 FROM programmable_custom_launch_api_v1.custom_launch_review_bindings_v1 b,
 programmable_custom_launch_api_v1.launch_requests l
 WHERE b.review_id=r.review_id AND b.chain_id='1' AND j.request_id=b.launch_id AND l.request_id=b.launch_id
 AND l.status IN('received','validating','pending_review','action_required');
 END IF;
 RETURN programmable_custom_launch_api_v1.custom_launch_review_json_v1(r.review_id);
END $$;
COMMIT;
