export function Input(props) {
  return (
    <input
      className="w-full rounded-xl border px-3 py-2 text-sm outline-none
                 bg-white text-slate-900 placeholder:text-slate-400
                 focus:ring-2 focus:ring-indigo-300
                 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 dark:border-slate-700"
      {...props}
    />
  );
}
export default Input;
