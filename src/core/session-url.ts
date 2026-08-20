/** Query names that must never carry an API key in a view_url or bookmark. */
export const KEY_QUERY_PARAMS = ["key", "apiKey", "api_key", "api-key"] as const;

export function stripKeyQueryParams(searchParams: URLSearchParams): boolean {
  let stripped = false;
  for (const name of KEY_QUERY_PARAMS) {
    if (searchParams.has(name)) {
      searchParams.delete(name);
      stripped = true;
    }
  }
  return stripped;
}
