import { NextResponse } from "next/server";

// Required for `output: export` (GitHub Pages build); dev server is unaffected.
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}