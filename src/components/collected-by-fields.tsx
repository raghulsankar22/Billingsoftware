"use client";

import { collectedByRelationLabels, type CollectedBy, type CollectedByRelation } from "@/lib/types";
import { capitalizeWords, holdCaret } from "@/lib/text-case";
import { EnglishRecordField } from "./english-record-field";
import { useLanguage } from "./language-provider";

export function CollectedByFields({ value, onChange, disabled, customerName }: { value: CollectedBy; onChange: (value: CollectedBy) => void; disabled: boolean; customerName?: string }) {
  const { t } = useLanguage();
  const relations = Object.entries(collectedByRelationLabels) as [CollectedByRelation, string][];
  return <div className="form-grid collected-by-fields">
    <label className="bill-receipt-field">{t("Who is taking the jewellery?")} <span className="muted">{t("(required)")}</span>
      <select aria-label={t("Who is taking the jewellery?")} value={value.relation} required disabled={disabled} onChange={event => onChange({ ...value, relation: event.target.value as CollectedBy["relation"] })}>
        <option value="">{t("Choose relation")}</option>
        {relations.map(([relation, label]) => <option key={relation} value={relation}>{t(label)}</option>)}
      </select>
    </label>
    {value.relation === "self"
      ? <label>{t("Name of the person")}<input aria-label={t("Name of the person")} value={customerName ?? t("Each bill's customer")} readOnly /></label>
      : <EnglishRecordField label="Name of the person" value={value.name} required={Boolean(value.relation)} minLength={2} maxLength={120} disabled={disabled} onChange={name => { holdCaret(); onChange({ ...value, name: capitalizeWords(name) }); }} />}
  </div>;
}
