/**
 * Минималистичная иконка: две восьмые ноты (quavers) с общим ребром — в стиле Telegram.
 */
export const LogoIcon = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden
  >
    {/* Общее ребро (beam) между штилями */}
    <path
      d="M12 10h8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Левая восьмая: головка + штиль */}
    <ellipse cx="9" cy="17" rx="3.2" ry="2.6" fill="currentColor" />
    <path d="M12 10v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    {/* Правая восьмая: головка + штиль */}
    <ellipse cx="23" cy="17" rx="3.2" ry="2.6" fill="currentColor" />
    <path d="M20 10v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
