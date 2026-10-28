import { billConditions as conditions } from "@/lib/bill-conditions";

export function BillConditions() {
  return <section className="bill-conditions" aria-label="Conditions">
    <h3>{conditions.heading}</h3>
    <p>{conditions.interest}<br />{conditions.interestExplanation}</p>
    <ol>{conditions.clauses.map((clause) => <li key={clause}>{clause}</li>)}</ol>
    <p className="conditions-centered">{conditions.redemption}</p>
    <p className="conditions-centered"><strong>{conditions.holidays}</strong></p>
    <div lang="ta" className="conditions-tamil">
      {conditions.tamilNotices.map((notice) => <p className="conditions-centered" key={notice}><strong>{notice}</strong></p>)}
      <p className="conditions-signature">{conditions.tamilSignature}</p>
      <div className="conditions-hours"><strong>{conditions.hoursHeading}</strong><div>{conditions.morning}<br />{conditions.evening}</div></div>
      <p><strong>{conditions.addressNotice}</strong></p>
    </div>
  </section>;
}
