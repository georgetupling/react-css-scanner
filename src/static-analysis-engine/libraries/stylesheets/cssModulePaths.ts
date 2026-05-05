export function isCssModulePath(filePathOrSpecifier: string): boolean {
  return /\.module\.(?:css|less|scss|sass)(?:[?#].*)?$/i.test(filePathOrSpecifier);
}

export function isStylesheetPath(filePathOrSpecifier: string): boolean {
  return /\.(?:css|less|scss|sass)(?:[?#].*)?$/i.test(filePathOrSpecifier);
}
