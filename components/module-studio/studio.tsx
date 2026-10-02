"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowRight, Check, ChevronDown, Coins, ImagePlus, Layers, LayoutGrid, Plus, Puzzle, SlidersHorizontal, Waves, X } from "lucide-react";
import type { FoundationModuleDescriptor, FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import { FOUNDATION_STUDIO_CATEGORIES, foundationStudioModules, foundationStudioSelection, type FoundationStudioCategory, type FoundationStudioDraft } from "@/lib/module-foundation/studio";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import type { ModuleSocialKind } from "@/lib/module-mode/token-metadata";
import { normalizeFoundationSocialInput } from "@/lib/module-foundation/social-input";
import { ModuleFoundationConfigField } from "../module-foundation-config-field";
import styles from "./studio.module.css";

export interface FoundationStudioProps {
  draft: FoundationStudioDraft;
  catalog: readonly FoundationModuleDescriptor[];
  imageSource?: string;
  quoteSymbol: string;
  quoteStatus?: string;
  initialBuy: string;
  actionLabel: string;
  disabled?: boolean;
  busy?: boolean;
  actionDisabled?: boolean;
  status?: string;
  error?: string;
  errors: Record<string, string>;
  customQuote: boolean;
  canResolveQuote: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  imageInput?: RefObject<HTMLInputElement | null>;
  preview?: boolean;
  emptyModulesMessage?: string;
  onUpdate: <K extends keyof FoundationStudioDraft>(key: K, value: FoundationStudioDraft[K]) => void;
  onSocialChange?: (kind: ModuleSocialKind, value: string) => void;
  onImageError?: () => void;
  onChooseImage: (file: File | undefined) => void;
  onRemoveImage: () => void;
  onQuoteChange: (address: string) => void;
  onDefaultQuote: () => void;
  onEnableQuote: () => void;
  onRetryAvailability?: () => void;
  onSubmit: (event: FormEvent) => void;
  onBack?: () => void;
}

const categoryLabels: Record<FoundationStudioCategory, string> = { trading: "Trading", fees: "Fees", supply: "Supply", liquidity: "Liquidity", other: "More" };
const categoryIcons = { trading: SlidersHorizontal, fees: Coins, supply: Layers, liquidity: Waves, other: Puzzle };
type Panel = "coin" | "quote" | "fees" | string;

/** Presentation only. Wallet preparation, simulation, locking and receipt handling remain in the launch host. */
export function FoundationStudio({ formRef, imageInput, ...props }: FoundationStudioProps) {
  const { draft, catalog, disabled, errors } = props;
  const [chosenPanel, setPanel] = useState<Panel>("coin");
  const [handledErrors, setHandledErrors] = useState("");
  const [category, setCategory] = useState<"all" | FoundationStudioCategory>("all");
  const [mobilePanel, setMobilePanel] = useState<"modules" | "canvas" | "settings">("canvas");
  const [savedConfigurations, setSavedConfigurations] = useState<Record<string, FoundationModuleSelection["configuration"]>>({});
  const [savedQuote, setSavedQuote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef<HTMLDialogElement>(null);
  const flowGradient = useId();
  useEffect(() => { if (pickerOpen && picker.current && !picker.current.open) picker.current.showModal(); }, [pickerOpen]);
  const errorSignature = Object.entries(errors).filter(([, value]) => value).map(([key, value]) => `${key}:${value}`).sort().join("|");
  const errorPanel = Object.keys(errors).some(key => ["name", "symbol", "description", "image", "initialBuy"].includes(key) || key.startsWith("social-")) ? "coin"
    : errors.quoteAsset ? "quote" : errors.creatorFeeBps ? "fees" : errors.modules ? draft.modules[0]?.id ?? "modules" : undefined;
  const panel = errorPanel && errorSignature !== handledErrors ? errorPanel : chosenPanel;
  const selected = catalog.find(item => item.id === panel);
  const selection = draft.modules.find(item => item.id === panel);
  const inspectedSelection = selected ? selection ?? foundationStudioSelection(selected, savedConfigurations[selected.id]) : undefined;
  const modules = foundationStudioModules(catalog, category);
  const categories = FOUNDATION_STUDIO_CATEGORIES.filter(value => value === "liquidity" && props.canResolveQuote || catalog.some(item => (item.studio?.category ?? "other") === value));
  const focusPanel = (id: Panel) => { setHandledErrors(errorSignature); setPanel(id); setMobilePanel("settings"); };
  const closePicker = () => { picker.current?.close(); setPickerOpen(false); };
  const disableQuote = () => { if (draft.quoteAsset) setSavedQuote(draft.quoteAsset); props.onDefaultQuote(); };
  const enableQuote = () => { if (savedQuote) props.onQuoteChange(savedQuote); else props.onEnableQuote(); focusPanel("quote"); };
  const blockedReason = (descriptor: FoundationModuleDescriptor) => {
    if (!descriptor.available) return descriptor.unavailableReason || "Module unavailable";
    if (draft.modules.some(item => item.id === descriptor.id)) return undefined;
    if (draft.modules.length >= 8) return "Select up to eight modules.";
    const conflict = descriptor.conflictsWith?.find(id => draft.modules.some(item => item.id === id));
    return conflict ? `Cannot combine with ${catalog.find(item => item.id === conflict)?.name ?? "a selected module"}.` : undefined;
  };
  const toggle = (descriptor: FoundationModuleDescriptor) => {
    if (disabled) return;
    const existing = draft.modules.find(item => item.id === descriptor.id);
    if (existing) { setSavedConfigurations(current => ({ ...current, [descriptor.id]: existing.configuration })); props.onUpdate("modules", draft.modules.filter(item => item.id !== descriptor.id)); }
    else if (!blockedReason(descriptor)) { props.onUpdate("modules", [...draft.modules, foundationStudioSelection(descriptor, savedConfigurations[descriptor.id])]); focusPanel(descriptor.id); }
  };
  const moduleNodes = draft.modules.slice(0, 3).map(item => ({ id: item.id, name: catalog.find(module => module.id === item.id)?.name ?? "Module", value: undefined, icon: <ModuleLogo category={catalog.find(module => module.id === item.id)?.studio?.category ?? "other"} /> }));
  const nodes = [
    { id: "quote", name: `${draft.symbol || "COIN"} / ${props.quoteSymbol}`, value: undefined, icon: <ModuleLogo quote /> },
    ...(draft.creatorFeeBps ? [{ id: "fees", name: "Creator fees", value: `${draft.creatorFeeBps / 100}%`, icon: <ModuleLogo category="fees" /> }] : []),
    ...moduleNodes,
    ...(draft.modules.length > 3 ? [{ id: "modules", name: `${draft.modules.length - 3} more modules`, value: "View all", icon: <Layers size={20} /> }] : []),
  ];
  const updateSocial = (key: ModuleSocialKind, value: string) => props.onSocialChange
    ? props.onSocialChange(key, value) : props.onUpdate("socialLinks", { ...draft.socialLinks, [key]: value });
  const field = (key: "name" | "symbol" | "description", label: string, placeholder: string, maxLength: number) => <label className={styles.field}>
    <span>{label}</span>{key === "description" ? <textarea id={`foundation-${key}`} rows={2} maxLength={maxLength} value={draft[key]} placeholder={placeholder} aria-invalid={Boolean(errors[key]) || undefined} onChange={event => props.onUpdate(key, event.target.value)} />
      : <input id={`foundation-${key}`} autoComplete="off" maxLength={maxLength} value={draft[key]} placeholder={placeholder} aria-invalid={Boolean(errors[key]) || undefined} onChange={event => props.onUpdate(key, key === "symbol" ? event.target.value.toUpperCase() : event.target.value)} />}
    {errors[key] ? <span className={styles.error}>{errors[key]}</span> : null}
  </label>;

  return <form className={styles.studio} ref={formRef} onSubmit={props.onSubmit} noValidate>
    <header className={styles.heading}>{props.preview ? <a className={styles.homeLogo} href="https://programmable.market" aria-label="Programmable home"><Image src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png" alt="" width={32} height={42} unoptimized /></a> : null}<div className={styles.title}><h1>Module Mode</h1><p>Choose your own rules for your coin.</p></div>{props.preview ? <span className={styles.previewTag}>Preview</span> : null}</header>
    <nav className={styles.mobileNavigation} aria-label="Studio panels">{(["modules", "canvas", "settings"] as const).map(value => <button type="button" key={value} aria-pressed={mobilePanel === value} onClick={() => setMobilePanel(value)}>{value === "canvas" ? "Your coin" : value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
    <fieldset className={styles.workspace} disabled={disabled} data-mobile-panel={errorPanel && errorSignature !== handledErrors ? "settings" : mobilePanel}>
      <aside id="studio-module-library" tabIndex={-1} className={styles.library} aria-label="Module library">
        <div className={styles.panelHeading}><h2>Modules</h2></div>
        <div className={styles.categoryTabs} aria-label="Module categories"><button type="button" aria-label="All modules" title="All modules" aria-pressed={category === "all"} onClick={() => setCategory("all")}><LayoutGrid size={18} aria-hidden="true" /></button>{categories.map(value => { const Icon = categoryIcons[value]; return <button type="button" key={value} aria-label={categoryLabels[value]} title={categoryLabels[value]} aria-pressed={category === value} onClick={() => setCategory(value)}><Icon size={18} aria-hidden="true" /></button>; })}</div>
        <div className={styles.moduleList}>
          {(category === "all" || category === "liquidity") && props.canResolveQuote ? <div className={styles.moduleCard} data-active={props.customQuote}>
            <button type="button" className={styles.moduleName} onClick={() => props.customQuote ? focusPanel("quote") : enableQuote()}><ModuleLogo quote /><span>Any Quote Pool</span></button>
            <button type="button" className={styles.toggle} role="switch" aria-label="Any Quote Pool" aria-checked={props.customQuote} onClick={() => props.customQuote ? disableQuote() : enableQuote()}><span /></button>
          </div> : null}
          {modules.map(module => { const enabled = draft.modules.some(item => item.id === module.id); return <div className={styles.moduleCard} key={`${module.id}:${module.version}`} data-active={enabled} data-unavailable={!module.available}>
            <button type="button" className={styles.moduleName} onClick={() => enabled || blockedReason(module) ? focusPanel(module.id) : toggle(module)}><ModuleLogo category={module.studio?.category ?? "other"} /><span>{module.name}</span></button>
            <button type="button" className={styles.toggle} role="switch" aria-label={module.name} aria-checked={enabled} disabled={!enabled && Boolean(blockedReason(module))} title={blockedReason(module)} onClick={() => toggle(module)}><span /></button>
          </div>; })}
          {!catalog.length ? <div className={styles.emptyCard}>{props.emptyModulesMessage || "No modules available"}</div> : null}
        </div>
      </aside>

      <section className={styles.market} aria-label="Coin composition">
        <div className={styles.canvas}>
          <button type="button" className={styles.canvasAdd} aria-label="Add module" onClick={() => setPickerOpen(true)} />
          <svg className={styles.connections} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={flowGradient} x1="15" y1="15" x2="85" y2="75" gradientUnits="userSpaceOnUse"><stop stopColor="#ad95e9" /><stop offset=".5" stopColor="#d7b4d2" /><stop offset="1" stopColor="#ef8a91" /></linearGradient></defs>
            {nodes.map((node, i) => {
              const right = i % 2 === 1;
              const y = 18 + Math.floor(i / 2) * (64 / Math.max(1, Math.ceil(nodes.length / 2) - 1));
              const path = `M 50 50 C ${right ? 69 : 31} 50, ${right ? 69 : 31} ${y}, ${right ? 83 : 17} ${y}`;
              return <g key={node.id} className={styles.connection} data-active={panel === node.id}><path className={styles.connectionBase} d={path} pathLength={100} stroke={`url(#${flowGradient})`} /><path className={styles.connectionPulse} d={path} pathLength={100} stroke={`url(#${flowGradient})`} style={{ animationDelay: `${-i * 1.7}s` }} /></g>;
            })}
          </svg>
          {nodes.map((node, i) => <button key={node.id} type="button" className={styles.flowNode} style={{ left: i % 2 ? "auto" : 16, right: i % 2 ? 16 : "auto", top: `${18 + Math.floor(i / 2) * (64 / Math.max(1, Math.ceil(nodes.length / 2) - 1))}%` }} onClick={() => node.id === "modules" ? setPickerOpen(true) : focusPanel(node.id)} aria-pressed={panel === node.id}><span className={styles.nodeIcon}>{node.icon}</span><strong>{node.name}</strong>{node.value ? <span className={styles.nodeValue}>{node.value}</span> : null}</button>)}
          <button type="button" className={styles.coinNode} onClick={() => focusPanel("coin")} aria-label="Edit coin details" aria-pressed={panel === "coin"}>
            <div className={styles.coinArtwork}><Image src={props.imageSource ?? FOUNDATION_DEFAULT_IMAGE.url} alt={`${draft.name || "Your coin"} artwork`} width={168} height={168} unoptimized onError={props.onImageError} /></div><strong>{draft.name || "Your coin"}</strong><span>${draft.symbol || "COIN"}</span><div className={styles.coinPair}>{draft.symbol || "COIN"} / {props.quoteSymbol}</div>
          </button>
        </div>
      </section>

      <aside className={styles.inspector} aria-label="Settings">
        <div className={styles.panelHeading}><h2>{panel === "coin" ? "Coin details" : panel === "quote" ? "Pool pair" : panel === "fees" ? "Creator fees" : panel === "modules" ? "Selected modules" : selected?.name ?? "Settings"}</h2><ModuleLogo quote={panel === "quote"} category={panel === "fees" ? "fees" : selected?.studio?.category ?? "other"} /></div>
        <div className={styles.inspectorContent} key={panel}>
          {panel === "coin" ? <>
            <div className={styles.imageControl}><button type="button" onClick={() => imageInput?.current?.click()}><ImagePlus size={20} />{props.imageSource ? "Change image" : "Add image"}</button>{props.imageSource ? <button type="button" aria-label="Remove coin image" onClick={props.onRemoveImage}><X size={18} /></button> : null}<input className={styles.hiddenInput} ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Coin image file" onChange={event => { props.onChooseImage(event.target.files?.[0]); event.target.value = ""; }} /></div>
            {errors.image ? <div className={styles.error}>{errors.image}</div> : null}
            {field("name", "Name", "Coin name", 48)}{field("symbol", "Ticker", "COIN", 12)}
            <StudioDetails title="Launch settings" forceOpen={Boolean(errors.initialBuy)}>
              <label className={styles.field}><span>First buy · ETH</span><input id="foundation-initial-buy" inputMode="decimal" value={props.initialBuy} aria-invalid={Boolean(errors.initialBuy) || undefined} placeholder="0" onChange={event => props.onUpdate("initialBuy", event.target.value)} />{errors.initialBuy ? <span className={styles.error}>{errors.initialBuy}</span> : null}</label>
              <button type="button" className={styles.summaryButton} onClick={() => focusPanel("fees")}><Coins size={18} /><span>Creator fees</span><strong>{draft.creatorFeeBps / 100}%</strong></button>
            </StudioDetails>
            <StudioDetails title="Description & links" forceOpen={Boolean(errors.description) || Object.keys(errors).some(key => key.startsWith("social-"))}>{field("description", "Description", "About your coin", 280)}{(["website", "twitter", "telegram", "discord", "github", "gitbook"] as const).map(key => <label key={key} className={styles.field}><span>{key === "twitter" ? "X" : key === "gitbook" ? "Docs" : key[0].toUpperCase() + key.slice(1)}</span><input id={`foundation-social-${key}`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={draft.socialLinks[key] ?? ""} aria-invalid={Boolean(errors[`social-${key}`]) || undefined} placeholder={key === "twitter" ? "@username" : "https://"} onChange={event => updateSocial(key, event.target.value)} onBlur={event => { const value = normalizeFoundationSocialInput(key, event.target.value); if (value !== event.target.value) updateSocial(key, value); }} />{errors[`social-${key}`] ? <span className={styles.error}>{errors[`social-${key}`]}</span> : null}</label>)}</StudioDetails>
          </> : panel === "quote" ? <>
            <button type="button" className={styles.quoteChoice} aria-pressed={!props.customQuote} onClick={disableQuote}><Waves size={22} /><strong>ETH</strong>{!props.customQuote ? <Check size={18} /> : null}</button>
            <label className={styles.field}><span>Any Quote Pool</span><input id="foundation-quote" value={props.customQuote ? draft.quoteAsset : ""} autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.quoteAsset) || undefined} placeholder="Token address · 0x…" onChange={event => props.onQuoteChange(event.target.value)} /></label>
            {props.quoteStatus || errors.quoteAsset ? <div className={errors.quoteAsset ? styles.error : styles.settingStatus} role="status">{errors.quoteAsset || props.quoteStatus}</div> : null}
          </> : panel === "fees" ? <>
            <label className={styles.largeNumber}><span>Buy & sell</span><div><input id="foundation-creator-fee" type="number" min={0} max={10} step={1} value={draft.creatorFeeBps / 100} onChange={event => props.onUpdate("creatorFeeBps", Number(event.target.value) * 100)} /><span>%</span></div></label>
            <input aria-label="Creator fees" className={styles.range} type="range" min={0} max={10} step={1} value={draft.creatorFeeBps / 100} onChange={event => props.onUpdate("creatorFeeBps", Number(event.target.value) * 100)} />
            <div className={styles.presets}>{[0, 1, 3, 5].map(value => <button type="button" key={value} aria-pressed={draft.creatorFeeBps === value * 100} onClick={() => props.onUpdate("creatorFeeBps", value * 100)}>{value}%</button>)}</div>
            <div className={styles.settingStatus}>Platform fee <strong>0.3%</strong></div>{errors.creatorFeeBps ? <div className={styles.error}>{errors.creatorFeeBps}</div> : null}
          </> : panel === "modules" ? draft.modules.map(item => <button type="button" className={styles.summaryButton} key={item.id} onClick={() => focusPanel(item.id)}><ModuleLogo category={catalog.find(module => module.id === item.id)?.studio?.category ?? "other"} />{catalog.find(module => module.id === item.id)?.name ?? "Module"}</button>) : selected ? <>
            {selected.fields.map(configField => <div className={styles.settingCard} data-kind={configField.kind} key={configField.key}><ModuleFoundationConfigField compact field={configField} id={`foundation-module-${encodeURIComponent(selected.id)}-${encodeURIComponent(configField.key)}`} value={inspectedSelection!.configuration[configField.key]} showErrors={Boolean(errors.modules)} onChange={value => {
              const next = { ...inspectedSelection!, configuration: { ...inspectedSelection!.configuration, [configField.key]: value } };
              setSavedConfigurations(current => ({ ...current, [selected.id]: next.configuration }));
              if (selection && selected.available) props.onUpdate("modules", draft.modules.map(item => item.id === selected.id ? next : item));
            }} /></div>)}
            <StudioDetails title="Details">{selected.description}{selected.fields.map(configField => configField.description ? <p key={configField.key}><strong>{configField.label}</strong><br />{configField.description}</p> : null)}</StudioDetails>
            {blockedReason(selected) ? <div className={styles.error}>{blockedReason(selected)}</div> : null}{errors.modules ? <div className={styles.error}>{errors.modules}</div> : null}
          </> : null}
        </div>
        <div className={styles.inspectorAction}>
          <button type="submit" className={styles.launch} disabled={props.actionDisabled || disabled} aria-busy={props.busy}>{props.actionLabel}<ArrowRight size={19} /></button>
          {props.error || props.status || props.onRetryAvailability ? <div className={styles.actionStatus} role={props.error ? "alert" : "status"}>{props.error ? <span className={styles.error}>{props.error}</span> : props.status ? <span>{props.status}</span> : null}{props.onRetryAvailability ? <button type="button" onClick={props.onRetryAvailability} disabled={props.busy}>Retry</button> : null}</div> : null}
        </div>
      </aside>
    </fieldset>
    {pickerOpen ? <dialog ref={picker} className={styles.picker} aria-labelledby="studio-picker-title" onClose={() => setPickerOpen(false)} onCancel={event => { event.preventDefault(); closePicker(); }} onClick={event => { if (event.target === event.currentTarget) closePicker(); }}>
      <div className={styles.pickerHeading}><h2 id="studio-picker-title">Add module</h2><button type="button" aria-label="Close module list" onClick={closePicker} autoFocus><X size={20} /></button></div>
      <div className={styles.pickerList}>{FOUNDATION_STUDIO_CATEGORIES.map(group => {
        const groupModules = foundationStudioModules(catalog, group);
        const quote = group === "liquidity" && props.canResolveQuote;
        if (!groupModules.length && !quote) return null;
        const Icon = categoryIcons[group];
        return <section key={group} className={styles.pickerGroup} aria-label={categoryLabels[group]}><h3><Icon size={16} aria-hidden="true" />{categoryLabels[group]}</h3>
          {quote ? <button type="button" disabled={disabled} className={styles.pickerModule} onClick={() => { closePicker(); if (props.customQuote) focusPanel("quote"); else enableQuote(); }}><ModuleLogo quote /><span>Any Quote Pool</span>{props.customQuote ? <Check size={18} /> : <Plus size={18} />}</button> : null}
          {groupModules.map(module => { const enabled = draft.modules.some(item => item.id === module.id); return <button type="button" key={module.id} className={styles.pickerModule} disabled={disabled || Boolean(blockedReason(module))} title={blockedReason(module)} onClick={() => { closePicker(); if (enabled) focusPanel(module.id); else toggle(module); }}><ModuleLogo category={module.studio?.category ?? "other"} /><span>{module.name}</span>{enabled ? <Check size={18} /> : <Plus size={18} />}</button>; })}
        </section>;
      })}{!catalog.length && !props.canResolveQuote ? <div className={styles.emptyCard}>{props.emptyModulesMessage || "No modules available"}</div> : null}</div>
    </dialog> : null}
  </form>;
}

function StudioDetails({ title, children, forceOpen = false }: { title: string; children: ReactNode; forceOpen?: boolean }) {
  const [expanded, setOpen] = useState(false);
  const open = forceOpen || expanded;
  const id = useId();
  return <section className={styles.details} data-open={open}><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)}>{title}<ChevronDown size={16} /></button>
    <div id={id} className={styles.fold} inert={!open} aria-hidden={!open}><div><div className={styles.foldContent}>{children}</div></div></div>
  </section>;
}

function ModuleLogo({ category = "other", quote = false }: { category?: FoundationStudioCategory; quote?: boolean }) {
  return <span className={styles.moduleArt} data-flower={quote ? "quote" : category} aria-hidden="true" />;
}
