export function Card({ className="", ...props }) {
  return <div className={`card rounded-2xl border bg-white shadow-sm dark:bg-slate-800 dark:border-slate-700 ${className}`} {...props} />;
}
export function CardContent({ className="", ...props }) {
  return <div className={`p-6 text-slate-800 dark:text-slate-100 ${className}`} {...props} />;
}
