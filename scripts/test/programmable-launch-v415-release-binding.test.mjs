import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import * as client from '../programmable-launch-v415-release-binding.mjs';
import {releaseBindingTools} from '../programmable-launch-release-assets.mjs';
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url));
test('4.1.5 binds both treasury policies and packaged V3 artifacts without changing historical API identity',()=>{
 const result=client.auditV415ClientSource({repositoryRoot});
 assert.equal(result.productionEvidenceVerified,false);
 assert.equal(result.binding.package.version,'4.1.5');
 assert.equal(result.binding.ethereumClient.profile36TreasuryV2Recipient,'0xD88539d3c4C460136a733A3Fd60cf6BF269079da');
 assert.equal(result.binding.ethereumClient.profile36TreasuryV2TradeFeePolicyHash,'sha256:e2025776ad3b12e6277575259cccf11444810365975209083fea534d8e70b4b5');
 assert.equal(result.binding.ethereumClient.profile36TradeFeePolicyHash,'sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3');
 assert.equal(result.binding.existingApiReleaseBinding.path,'docs/operations/releases/custom-launch-v4.1/cli-release-binding.json');
 assert.ok(result.binding.clientFiles.some(x=>x.path.endsWith('/EthereumNative30HookV3.artifact.json')));
 assert.ok(result.binding.clientFiles.some(x=>x.path.endsWith('/EthereumNativeFeeVaultV3.artifact.json')));
 assert.equal(releaseBindingTools('4.1.5'),client);
 const schema=JSON.parse(readFileSync(repositoryRoot+'/docs/operations/releases/custom-launch-v4.1.5/cli-release-binding.schema.json'));
 const validate=new Ajv2020({strict:false}).compile(schema);assert.ok(validate(result.binding),JSON.stringify(validate.errors));
});
test('4.1.5 source audit rejects a substituted treasury or omitted package artifact',()=>{
 const binding=client.createV415ClientReleaseBinding({repositoryRoot});
 for(const mutate of [b=>b.ethereumClient.profile36TreasuryV2Recipient='0x'+'11'.repeat(20),b=>b.clientFiles.pop()]){
  const changed=structuredClone(binding);mutate(changed);
  assert.throws(()=>client.auditV415ClientSource({repositoryRoot,bindingBytes:Buffer.from(JSON.stringify(changed))}),/exact client source binding/);
 }
});
