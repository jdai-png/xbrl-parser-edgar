// Interface definitions for filings and XBRL data structures

/**
 * Represents a single filing document as retrieved from SEC EDGAR.
 */
export interface Filing {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
}

/**
 * Represents a tag within an XBRL taxonomy, defining its properties.
 */
export interface XBRLTag {
  tag: string;
  label: string;
  datatype?: string;
  abstract?: boolean;
  parentTag?: string;
}

/**
 * Represents a single fact (a piece of data) from an XBRL instance document.
 */
export interface XBRLFact {
  concept: string;
  value: string | number;
  contextRef: string;
  unitRef?: string;
  decimals?: string;
  label?: string;
}

/**
 * Represents a context within an XBRL instance document, defining the circumstances of a fact.
 */
export interface XBRLContext {
  id: string;
  entityIdentifier: string;
  period: {
    instant?: string;
    startDate?: string;
    endDate?: string;
  };
  dimensions?: { [key: string]: string };
}

/**
 * Represents the final, structured data extracted from a set of XBRL files for a single filing.
 */
export interface ExtractedData {
  companyName: string;
  cik: string;
  filingDate: string;
  formType: string;
  facts: XBRLFact[];
  contexts: { [id: string]: XBRLContext };
  tags: { [tag: string]: XBRLTag };
}
