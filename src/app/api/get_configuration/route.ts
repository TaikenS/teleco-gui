import { NextResponse } from "next/server";

export type AppConfiguration = {
    version: string;
    features: string[];
};

export async function POST() {
    const configuration: AppConfiguration = {
        version: "0.1",
        features: ["devicePicker", "preview", "logging"],
    };
    return NextResponse.json(configuration);
}