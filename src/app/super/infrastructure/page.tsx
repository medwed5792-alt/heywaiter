"use client";

import dynamic from "next/dynamic";

const SuperInfrastructureInner = dynamic(
  () => import("./SuperInfrastructureInner"),
  { ssr: false }
);

export default function SuperInfrastructurePage() {
  return <SuperInfrastructureInner />;
}
