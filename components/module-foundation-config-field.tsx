import type { FoundationConfigurationField } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";

export function ModuleFoundationConfigField({ field, id, value, showErrors, onChange }: {
  field: FoundationConfigurationField;
  id: string;
  value: string | boolean | undefined;
  showErrors?: boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.kind === "boolean") return <label className={styles.checkLabel}><input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /><span><strong>{field.label}</strong>{field.description ? <small>{field.description}</small> : null}</span></label>;
  const missing = Boolean(showErrors && field.required && (value === undefined || (typeof value === "string" && !value.trim())));
  const describedBy = [field.description ? `${id}-help` : "", missing ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}>
    <label htmlFor={id}>{field.label}</label>
    {field.kind === "select" ? <select id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input id={id} value={String(value ?? "")} required={field.required} aria-invalid={missing || undefined} autoComplete="off" spellCheck={false} inputMode={field.kind === "decimal" ? "decimal" : field.kind === "integer" ? "numeric" : "text"} aria-describedby={describedBy} onChange={event => onChange(event.target.value)} />}
    {field.description ? <p id={`${id}-help`} className={styles.help}>{field.description}</p> : null}
    {missing ? <p id={`${id}-error`} className={styles.error}>Complete {field.label}.</p> : null}
  </div>;
}
