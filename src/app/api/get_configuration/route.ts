import { NextResponse } from "next/server";

export type AppConfiguration = {
  version: string;
  features: string[];
};

export const dynamic = "force-static";

function buildConfiguration() {
  const configuration: AppConfiguration = {
    version: "0.1",
    features: ["devicePicker", "preview", "logging"],
  };
  return configuration;
}

export async function GET() {
  return NextResponse.json(buildConfiguration());
}

// Backward compatible endpoint for existing callers.
export async function POST() {
  return NextResponse.json(buildConfiguration());
}
