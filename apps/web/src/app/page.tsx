import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export default function HomePage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
