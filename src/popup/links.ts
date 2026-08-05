export interface PopupLinks {
  readonly contributeFeature: string;
  readonly rateExtension: string;
  readonly reportBug: string;
  readonly requestFeature: string;
}

const REPOSITORY_URL =
  "https://github.com/noahsbates/Regex-Tab-Dedupe-Chrome-Extension";

export function createPopupLinks(extensionId: string): PopupLinks {
  return {
    contributeFeature: `${REPOSITORY_URL}/pulls`,
    reportBug: `${REPOSITORY_URL}/issues/new?labels=bug&title=%5BBug%5D%20`,
    rateExtension: `https://chromewebstore.google.com/detail/${encodeURIComponent(extensionId)}/reviews`,
    requestFeature: `${REPOSITORY_URL}/issues/new?labels=enhancement&title=%5BFeature%5D%20`,
  };
}
