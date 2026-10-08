import type { Metadata } from "next";
import { CustomLaunchReviewConsole } from "@/components/custom-launch-review-console";
export const metadata: Metadata = { title: "Launch reviews · Programmable", robots: { index: false, follow: false } };
export default function CustomLaunchReviewsPage() { return <CustomLaunchReviewConsole />; }
