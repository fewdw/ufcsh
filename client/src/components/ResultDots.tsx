import { resultDot, type FormResult } from "../resultDots";

export default function ResultDots({ results, label = "Recent results, oldest first", reverse = false, className = "" }: { results: FormResult[]; label?: string; reverse?: boolean; className?: string }) {
  if (!results.length) return null;
  return <span className={`inline-flex flex-wrap items-center justify-center gap-1 ${reverse ? "flex-row-reverse" : ""} ${className}`} role="img" aria-label={`${label}: ${results.map((result) => resultDot(result).label).join(", ")}`}>
    {results.map((result, index) => {
      const dot = resultDot(result);
      return <span key={index} className={`h-2 w-2 ${dot.className}`} data-result-kind={dot.kind} title={dot.label} />;
    })}
  </span>;
}
