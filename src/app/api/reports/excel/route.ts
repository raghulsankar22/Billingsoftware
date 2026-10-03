import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { itemSummary } from "@/lib/money";
import { registerHeaders } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id);
    if (!profile) throw new Error("Business profile is required.");
    const { data, error } = await createAdminSupabase().from("bills").select("*, bill_items(*)").eq("profile_id", profile.id).order("bill_number");
    if (error) throw error;
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Bills");
    sheet.addRow([...registerHeaders]); sheet.getRow(1).font = { bold: true };
    for (const bill of data ?? []) {
      const items = (bill.bill_items as Array<{ particulars: string; grams: number | string; assessed_value: number | string; loan_amount: number | string }> || []).map((item) => ({ particulars: item.particulars, grams: Number(item.grams), assessedValue: Number(item.assessed_value), loanAmount: Number(item.loan_amount) }));
      sheet.addRow([bill.delivery_no || "", bill.delivery_date || "", bill.bill_date, bill.bill_number, bill.address, bill.customer_name, itemSummary(items), bill.phone, Number(bill.total_loan_amount)]);
    }
    sheet.columns.forEach((column) => { column.width = 18; }); sheet.getColumn(5).width = 34; sheet.getColumn(7).width = 48; sheet.getColumn(9).numFmt = '₹#,##0.00';
    const bytes = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="Finance Billing Register.xlsx"' } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export Excel register" }, { status: 400 }); }
}
