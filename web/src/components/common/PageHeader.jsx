export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h2 className="text-xl font-bold text-black">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground font-medium">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
export function PrimaryButton({ className = "", ...p }) {
  return (
    <button
      {...p}
      className={`border-2 border-black bg-[#024BAB] text-white px-4 py-2 text-sm flex items-center justify-center gap-1.5 font-bold hover:bg-[#01368A] transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
    />
  );
}
export function SecondaryButton({ className = "", ...p }) {
  return (
    <button
      {...p}
      className={`border-2 border-black bg-white text-black px-4 py-2 text-sm flex items-center justify-center gap-1.5 font-bold hover:bg-[#024BAB]/10 transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
    />
  );
}
