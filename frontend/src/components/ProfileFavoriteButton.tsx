import type { MouseEvent } from "react";

import { SparklesIcon } from "./SparklesIcon";

type ProfileFavoriteButtonProps = {
  favorite: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function ProfileFavoriteButton({
  favorite,
  label,
  onClick,
}: ProfileFavoriteButtonProps) {
  return (
    <button
      type="button"
      className={`secondary icon-only-button compatibility-profile-quick-action${favorite ? " is-favorite" : ""}`}
      aria-label={label}
      aria-pressed={favorite}
      title={label}
      onClick={onClick}
    >
      <SparklesIcon size={18} aria-hidden="true" className="nav-icon" />
    </button>
  );
}
