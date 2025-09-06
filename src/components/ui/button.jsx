export function Button({ as:Comp="button", variant="primary", className="", ...props }) {
  const base = "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition";
  const styles =
    variant === "outline"
      ? "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
      : "bg-indigo-600 text-white hover:bg-indigo-700";
  return <Comp className={`${base} ${styles} ${className}`} {...props} />;
}
export default Button;
