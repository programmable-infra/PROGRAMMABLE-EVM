"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import type { Address } from "viem";
import { foundationSelectionErrors, type FoundationModuleDescriptor, type FoundationModuleSelection, type FoundationQuoteAsset } from "@/lib/module-foundation/ui-types";
import { ModulePickerDialog } from "./module-picker-dialog";
import { ModuleFoundationConfigField } from "./module-foundation-config-field";
import styles from "./module-foundation-ui.module.css";

type Lookup = { address: string; asset?: FoundationQuoteAsset; error?: string };

export function ModuleFoundationPairDialog({ chainId, initialView, initialAddress = "", initialAsset, quoteAssets, catalog, selectedModules, onApplyModule, onResolveQuote, onApply, onClose }: {
  chainId: number;
  initialView: "modules" | "quote";
  initialAddress?: string;
  initialAsset?: FoundationQuoteAsset;
  quoteAssets: readonly FoundationQuoteAsset[];
  catalog: readonly FoundationModuleDescriptor[];
  selectedModules: readonly FoundationModuleSelection[];
  onApplyModule: (selection: FoundationModuleSelection) => void;
  onResolveQuote?: (address: Address) => Promise<FoundationQuoteAsset>;
  onApply: (asset: FoundationQuoteAsset) => void;
  onClose: () => void;
}) {
  const [configuring, setConfiguring] = useState(initialView === "quote");
  const [moduleConfiguration, setModuleConfiguration] = useState<{ descriptor: FoundationModuleDescriptor; selection: FoundationModuleSelection } | null>(null);
  const [showModuleErrors, setShowModuleErrors] = useState(false);
  const [address, setAddress] = useState(initialAddress);
  const [lookup, setLookup] = useState<Lookup | null>(initialAsset ? { address: initialAddress, asset: initialAsset } : null);
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const resolver = useRef(onResolveQuote);
  useLayoutEffect(() => { resolver.current = onResolveQuote; }, [onResolveQuote]);
  const trimmed = address.trim();
  const validAddress = /^0x[0-9a-fA-F]{40}$/.test(trimmed);
  const known = quoteAssets.find(asset => asset.chainId === chainId && asset.address.toLowerCase() === trimmed.toLowerCase());
  const current = lookup?.address.toLowerCase() === trimmed.toLowerCase() ? lookup : null;
  const asset = known ?? current?.asset;
  const error = current?.error ?? (asset && !asset.supported ? asset.reason ?? "This token is not supported." : undefined);
  const supported = Boolean(asset?.supported && asset.chainId === chainId && !asset.supportsNativeEth);
  const moduleErrors = moduleConfiguration ? foundationSelectionErrors([
    ...selectedModules.filter(selection => selection.id !== moduleConfiguration.descriptor.id), moduleConfiguration.selection,
  ], catalog) : [];
  const editingModule = moduleConfiguration && selectedModules.some(selection => selection.id === moduleConfiguration.descriptor.id);

  useEffect(() => {
    if (!configuring || !validAddress || known || !resolver.current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void resolver.current!(trimmed as Address).then(resolved => {
        if (cancelled) return;
        if (resolved.address.toLowerCase() !== trimmed.toLowerCase() || resolved.chainId !== chainId || !Number.isInteger(resolved.decimals) || resolved.decimals < 0 || resolved.decimals > 36) {
          throw new Error("This token could not be verified. Check its address and try again.");
        }
        setLookup({ address: trimmed, asset: resolved });
      }).catch(caught => {
        if (!cancelled) setLookup({ address: trimmed, error: caught instanceof Error && caught.message.length <= 320 ? caught.message : "This token could not be checked. Try again." });
      });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [chainId, configuring, known, trimmed, validAddress, retry]);

  return <ModulePickerDialog variant="compact" animateOpen title={moduleConfiguration?.descriptor.name ?? (configuring ? "Any Quote Pool" : "Add modules")}
    description={moduleConfiguration?.descriptor.description ?? (configuring ? "Pair your coin with another token instead of ETH." : "Choose modules individually or combine them.")}
    onClose={onClose} doneLabel={moduleConfiguration ? editingModule ? "Save module" : "Add module" : configuring ? initialAddress ? "Save module" : "Add module" : "Done"}
    doneDisabled={configuring && !supported} onDone={() => {
      if (moduleConfiguration) {
        setShowModuleErrors(true);
        if (!moduleErrors.length) { onApplyModule(moduleConfiguration.selection); setModuleConfiguration(null); setShowModuleErrors(false); }
        return;
      }
      if (!configuring) { onClose(); return; }
      if (asset && supported) { onApply(asset); if (initialView === "quote") onClose(); else setConfiguring(false); }
    }}
    footer={configuring || moduleConfiguration ? <button type="button" className={styles.textButton} onClick={() => { setConfiguring(false); setModuleConfiguration(null); setShowModuleErrors(false); }}><ArrowLeftIcon size={16} aria-hidden="true" /> Modules</button> : undefined}>
    {moduleConfiguration ? <div className={styles.moduleConfiguration}>
      {moduleConfiguration.descriptor.fields.map(field => <ModuleFoundationConfigField key={field.key} field={field}
        id={`foundation-picker-${encodeURIComponent(moduleConfiguration.descriptor.id)}-${encodeURIComponent(field.key)}`}
        value={moduleConfiguration.selection.configuration[field.key]} showErrors={showModuleErrors}
        onChange={value => setModuleConfiguration(current => current ? { ...current, selection: { ...current.selection, configuration: { ...current.selection.configuration, [field.key]: value } } } : null)} />)}
      {showModuleErrors && moduleErrors.length ? <p className={styles.error} role="alert">{moduleErrors.join(" ")}</p> : null}
    </div> : configuring ? <div className={styles.pairConfiguration}>
      <div className={styles.field}>
        <label htmlFor="foundation-pair-address">Token address</label>
        <input ref={input} id="foundation-pair-address" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="0x…" value={address}
          aria-invalid={Boolean(error) || undefined} aria-describedby="foundation-pair-status"
          onChange={event => { setAddress(event.target.value); setLookup(null); }} />
        <p id="foundation-pair-status" className={error ? styles.error : supported ? styles.saved : styles.help} role="status">
          {error ?? (supported ? <><CheckIcon size={16} aria-hidden="true" /> {asset?.name} · {asset?.symbol}</> : asset?.supportsNativeEth ? "ETH is already included in Classic." : validAddress ? "Checking token…" : trimmed ? "Enter a complete token address." : "Paste a contract address on Robinhood Chain.")}
        </p>
        {current?.error ? <button type="button" className={styles.textButton} onClick={() => { setLookup(null); setRetry(value => value + 1); }}>Try again</button> : null}
      </div>
    </div> : <div className={styles.catalog}>
    {onResolveQuote ? <button type="button" className={styles.moduleOption} aria-pressed={Boolean(initialAddress)} onClick={() => {
      setConfiguring(true); requestAnimationFrame(() => input.current?.focus());
    }}>
      <PlugsConnectedIcon size={24} aria-hidden="true" />
      <span><strong>Any Quote Pool</strong><small>{initialAddress ? `${initialAsset?.symbol ?? "Token"} selected · Edit token` : "Pair with another token instead of ETH."}</small></span>
      {initialAddress ? <CheckIcon size={20} aria-hidden="true" /> : <ArrowRightIcon size={20} aria-hidden="true" />}
    </button> : null}
    {catalog.map(descriptor => {
      const selected = selectedModules.some(selection => selection.id === descriptor.id);
      return <button key={`${descriptor.id}:${descriptor.version}`} type="button" className={styles.moduleOption}
        aria-pressed={selected} disabled={!descriptor.available} onClick={() => {
          const current = selectedModules.find(selection => selection.id === descriptor.id);
          setModuleConfiguration({ descriptor, selection: current ?? { id: descriptor.id, version: descriptor.version, digest: descriptor.digest,
            configuration: Object.fromEntries(descriptor.fields.map(field => [field.key, field.defaultValue ?? (field.kind === "boolean" ? false : "")])) } });
          setShowModuleErrors(false);
          requestAnimationFrame(() => document.getElementById(`foundation-picker-${encodeURIComponent(descriptor.id)}-${encodeURIComponent(descriptor.fields[0]?.key ?? "")}`)?.focus());
        }}>
        <span><strong>{descriptor.name}</strong><small>{descriptor.available ? descriptor.description : descriptor.unavailableReason ?? "This module is currently unavailable."}</small></span>
        {selected ? <CheckIcon size={20} aria-hidden="true" /> : <ArrowRightIcon size={20} aria-hidden="true" />}
      </button>;
    })}
    </div>}
  </ModulePickerDialog>;
}
