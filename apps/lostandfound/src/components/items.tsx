// The pieces both halves of the app draw items with: a colour swatch and a
// grid card. The public grid and the staff dashboard use the same card, so a
// staff member sees an item the way a family will.
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LfCrop } from "@sd/shared";
import { useI18n } from "../i18n/index.js";
import { SWATCHES, colorLabel, foundAgo } from "../lib/lf.js";

export function Swatch({ color }: { color: string }) {
  const { t } = useI18n();
  const label = colorLabel(t, color);
  return (
    <span
      className="lf-swatch"
      role="img"
      aria-label={label}
      title={label}
      style={{ background: SWATCHES[color] ?? "#ccc" }}
    />
  );
}

/** A square tile showing the AI's suggested crop of a photo, or the usual
 *  centre fit when there is none. Only the display moves: the file is whole.
 *  The crop is a rectangle in fractions of the image, square in pixels, so the
 *  tile needs no aspect ratio: scaling the image to 1/w by 1/h of the tile and
 *  shifting it by x/w and y/h puts exactly that rectangle in view. */
export function CropImage({ src, alt, crop, loading }: { src: string; alt: string; crop?: LfCrop | null; loading?: "lazy" }) {
  if (!crop) return <img src={src} alt={alt} loading={loading} />;
  return (
    <div className="lf-crop">
      <img
        src={src}
        alt={alt}
        loading={loading}
        style={{
          width: `${100 / crop.w}%`,
          height: `${100 / crop.h}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
    </div>
  );
}

export interface CardItem {
  id: string;
  title: string;
  colors: string[];
  foundAt: string;
  thumbUrl: string;
  /** The AI's suggested square for the tile; absent or null = centre fit. */
  crop?: LfCrop | null;
  /** No description yet — the model is still working, or gave up. */
  untitled: boolean;
}

export function ItemCard({
  item,
  to,
  extra,
  selected,
  onToggle,
}: {
  item: CardItem;
  to: string;
  extra?: ReactNode;
  /** With `onToggle` the card is a selection toggle (the staff dashboard's
   *  bulk mode) instead of a link; `selected` is its state. The click event is
   *  passed through so the caller can read shift for range selection. */
  selected?: boolean;
  onToggle?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useI18n();
  const title = item.untitled ? t("lfDescribing") : item.title;
  const body = (
    <>
      {/* Alt is the item's title: the photo IS the item, and the title is the
          best words there are for it. An undescribed one says so. */}
      <CropImage src={item.thumbUrl} alt={title} crop={item.crop} loading="lazy" />
      <div className="lf-card-body">
        <div className="lf-card-title">{title}</div>
        <div className="lf-card-meta">
          {item.colors.map((c) => (
            <Swatch key={c} color={c} />
          ))}
          <span style={{ marginLeft: item.colors.length ? 4 : 0 }}>{foundAgo(t, item.foundAt)}</span>
        </div>
        {extra}
      </div>
    </>
  );
  if (onToggle) {
    return (
      <button type="button" className="lf-card lf-card-select" aria-pressed={selected} onClick={onToggle}>
        {selected && <span className="lf-card-pick" aria-hidden="true">✓</span>}
        {body}
      </button>
    );
  }
  return (
    <Link className="lf-card" to={to}>
      {body}
    </Link>
  );
}
