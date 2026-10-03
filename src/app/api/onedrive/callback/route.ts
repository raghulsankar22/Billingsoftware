import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "Use Connect Google Drive in the billing app." }, { status: 410 }); }
export async function POST() { return GET(); }
