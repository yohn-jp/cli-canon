/** Package metadata explicitly supplied by a product composition root. */
export type ProductBinIdentity = string | Readonly<Record<string, string>>;

export interface ProductPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly bin?: ProductBinIdentity;
}
