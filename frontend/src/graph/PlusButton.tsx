/** The [+] shown under a hovered node or edge pill (revealed via CSS on parent :hover). */
export function PlusButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    // The wrapper's padding bridges the gap to the element, so hover isn't lost on the way down.
    <div className="plus-slot nodrag nopan">
      <button
        type="button"
        className="plus-button"
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation(); // don't also select the element underneath
          onClick();
        }}
      >
        +
      </button>
    </div>
  );
}
