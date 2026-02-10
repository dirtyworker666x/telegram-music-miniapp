import { Search } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
};

export const SearchBar = ({ value, onChange, onSubmit }: SearchBarProps) => {
  return (
    <div className="glass rounded-full px-5 py-3.5 flex items-center gap-3 shadow-card">
      <Search className="h-4 w-4 text-text-muted shrink-0" />
      <input
        className="w-full bg-transparent outline-none text-[15px] font-medium placeholder:text-text-muted"
        placeholder="Поиск треков, артистов..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit?.();
          }
        }}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  );
};
