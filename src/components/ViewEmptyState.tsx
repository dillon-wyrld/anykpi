import {
  VIEW_EMPTY_COPY,
  viewEmptyActionHref,
  viewEmptyActionTestId,
  viewEmptyTestId,
  type ViewId,
} from "@/components/view-empty-state";

export function ViewEmptyState({
  view,
  workspace,
}: {
  view: ViewId;
  workspace?: string;
}) {
  const copy = VIEW_EMPTY_COPY[view];
  const href = viewEmptyActionHref(workspace);

  return (
    <div
      className="bg-panel border border-border rounded-lg p-8 max-w-xl"
      data-testid={viewEmptyTestId(view)}
    >
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="text-sm text-sub mt-2">{copy.what}</p>
      <a
        href={href}
        data-testid={viewEmptyActionTestId(view)}
        className="inline-flex mt-4 px-4 py-2 bg-accent text-white text-sm rounded hover:opacity-90"
      >
        {copy.action}
      </a>
    </div>
  );
}
