export interface Provider {
  id: string;
  name: string;
  searchUrl(query: string): string;
  enlarge(image: string): string;
}

const slug = (query: string): string =>
  query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const PROVIDERS: readonly Provider[] = [
  {
    id: "dribbble",
    name: "Dribbble",
    searchUrl: (query) => `https://dribbble.com/search/${slug(query)}`,
    enlarge: (image) => image.replace(/resize=\d+x\d+/, "resize=800x600"),
  },
  {
    id: "pinterest",
    name: "Pinterest",
    searchUrl: (query) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
    enlarge: (image) => image.replace("/236x/", "/736x/"),
  },
  {
    id: "awwwards",
    name: "Awwwards",
    searchUrl: (query) => `https://www.awwwards.com/websites/?text=${encodeURIComponent(query)}`,
    enlarge: (image) => image,
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as [string, ...string[]];

export function providerById(id: string): Provider {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) {
    throw new Error(
      `Unknown reference provider ${id}. Use ${PROVIDERS.map((p) => p.id).join(", ")}.`,
    );
  }
  return found;
}
