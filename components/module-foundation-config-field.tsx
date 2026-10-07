import { foundationConfigurationError, type FoundationConfigurationField } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";

export function ModuleFoundationConfigField({ field, id, value, showErrors, compact, onChange }: {
  field: FoundationConfigurationField;
  id: string;
  value: string | boolean | undefined;
  showErrors?: boolean;
  compact?: boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.kind === "boolean") return <label className={styles.checkLabel}><input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /><span><strong>{field.label}</strong>{!compact && field.description ? <small>{field.description}</small> : null}</span></label>;
  const error = showErrors ? foundationConfigurationError(field, value) : null;
  const describedBy = [field.description ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={styles.field}>
    <label htmlFor={id}>{field.label}</label>
    {field.kind === "select" ? <select id={id} value={String(value ?? "")} required={field.required} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input id={id} value={String(value ?? "")} required={field.required} aria-invalid={Boolean(error) || undefined} autoComplete="off" spellCheck={false} inputMode={field.kind === "decimal" ? "decimal" : field.kind === "integer" ? "numeric" : "text"} aria-describedby={describedBy} onChange={event => onChange(event.target.value)} />}
    {field.description ? <p id={`${id}-help`} className={compact ? styles.srOnly : styles.help}>{field.description}</p> : null}
    {error ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
  </div>;
}
