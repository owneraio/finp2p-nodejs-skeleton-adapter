/** What an item is about: an asset, by one of its identifiers. */
export interface DataIdentifier {
  identifierType: string;
  identifierValue: string;
}

/** One piece of data about one asset, of one data type. */
export interface DataItem {
  identifier: DataIdentifier;
  dataType: string;
  data: Record<string, unknown>;
}

/**
 * Where items come from. A plugin implements it; the adapter hands it to a
 * `FeedPublisher`. `items()` yields a page at a time, and a throw ends the
 * round for this source. An item of a data type not in `dataTypes` is
 * refused without being sent.
 */
export interface DataProvider {
  readonly source: string;
  readonly dataTypes: readonly string[];
  items(): AsyncIterable<DataItem[]>;
}
