import { Check, Clock3, Minus, X } from "lucide-react";

type StatusPillProps = {
  state: "yes" | "no" | "pass" | "fail" | "pending";
  label?: string;
};

const icons = {
  yes: Check,
  no: Minus,
  pass: Check,
  fail: X,
  pending: Clock3,
};

export function StatusPill({ state, label }: StatusPillProps) {
  const Icon = icons[state];

  return (
    <span className={`status-pill ${state}`}>
      <Icon size={12} />
      <span>{label ?? defaultLabel(state)}</span>
    </span>
  );
}

function defaultLabel(state: StatusPillProps["state"]) {
  switch (state) {
    case "yes":
      return "Generated";
    case "no":
      return "Missing";
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
    case "pending":
      return "Pending";
  }
}
