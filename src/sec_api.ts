import Bun from "bun";
import { type Filing } from "./types";

/**
 * Handles interactions with the SEC EDGAR API, including rate limiting.
 */
export class SecApi {
  private lastRequestTime: number;
  private readonly minDelay: number;

  constructor() {
    this.lastRequestTime = 0;
    // Minimum delay of 150ms between requests to respect SEC rate limits (under 10 req/sec)
    this.minDelay = 150;
  }

  /**
   * Waits to respect SEC rate limits between requests.
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelay) {
      const waitTime = this.minDelay - timeSinceLastRequest;
      await Bun.sleep(waitTime);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Fetches a document from a given URL with rate limiting.
   * @param url The URL of the document to fetch.
   * @returns The document content as a string.
   */
  public async fetchDocument(url: string): Promise<string> {
    await this.waitForRateLimit();

    try {
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 XBRLProcessor/1.0 (contact@example.com)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };

      const response = await fetch(url, {
        method: "GET",
        headers: headers,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${url}`
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error fetching document: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetches all recent and historical filings for a given CIK.
   * @param cik The CIK of the company.
   * @param formTypes Optional array of form types to filter by.
   * @returns An array of Filing objects.
   */
  public async getAllFilings(
    cik: string,
    formTypes?: string[]
  ): Promise<Filing[]> {
    console.log(`Fetching all filings for CIK: ${cik}`);
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik.padStart(
      10,
      "0"
    )}.json`;

    try {
      const data = await this.fetchDocument(submissionsUrl);
      const submissions = JSON.parse(data);
      const allFilings: Filing[] = [];

      const recentFilings = submissions.filings.recent;
      for (let i = 0; i < recentFilings.form.length; i++) {
        const form = recentFilings.form[i];

        if (
          formTypes &&
          !formTypes.some((ft) => ft.toUpperCase() === form.toUpperCase())
        ) {
          continue;
        }

        allFilings.push({
          form: form,
          filingDate: recentFilings.filingDate[i],
          accessionNumber: recentFilings.accessionNumber[i],
          primaryDocument: recentFilings.primaryDocument[i],
        });
      }

      if (submissions.filings.files && submissions.filings.files.length > 0) {
        for (const fileInfo of submissions.filings.files) {
          try {
            const historicalUrl = `https://data.sec.gov/submissions/${fileInfo.name}`;
            const historicalData = await this.fetchDocument(historicalUrl);
            const historicalSubmissions = JSON.parse(historicalData);

            for (let i = 0; i < historicalSubmissions.form.length; i++) {
              const form = historicalSubmissions.form[i];

              if (
                formTypes &&
                !formTypes.some((ft) => ft.toUpperCase() === form.toUpperCase())
              ) {
                continue;
              }

              allFilings.push({
                form: form,
                filingDate: historicalSubmissions.filingDate[i],
                accessionNumber: historicalSubmissions.accessionNumber[i],
                primaryDocument: historicalSubmissions.primaryDocument[i],
              });
            }
          } catch (error) {
            console.warn(
              `Failed to fetch historical filing data from ${fileInfo.name}: ${error}`
            );
          }
        }
      }

      return allFilings.sort(
        (a, b) =>
          new Date(b.filingDate).getTime() - new Date(a.filingDate).getTime()
      );
    } catch (error) {
      console.error(`Error fetching filings: ${error}`);
      throw error;
    }
  }

  /**
   * Finds XBRL file URLs from an HTML content.
   * @param content The HTML content to search.
   * @param baseUrl The base URL to construct full paths.
   * @returns An array of unique XBRL file URLs.
   */
  public findXBRLFiles(content: string, baseUrl: string): string[] {
    const xbrlRegex = /href\s*=\s*["']([^"']*\.(?:xml|xsd))["']/gi;
    const urls: string[] = [];
    let match;

    while ((match = xbrlRegex.exec(content)) !== null) {
      const relativePath = match[1];

      // This logic identifies the primary instance document and related schema/definition files.
      if (
        relativePath.includes("_pre.xml") || // Presentation
        relativePath.includes("_cal.xml") || // Calculation
        relativePath.includes("_def.xml") || // Definition
        relativePath.includes("_lab.xml") || // Label
        // More robustly find the instance file: it's any .xml file that ISN'T a known linkbase type.
        (relativePath.endsWith(".xml") &&
          !relativePath.includes("_pre.xml") &&
          !relativePath.includes("_cal.xml") &&
          !relativePath.includes("_def.xml") &&
          !relativePath.includes("_lab.xml"))
      ) {
        try {
          let fullUrl: string;
          if (relativePath.startsWith("http")) {
            fullUrl = relativePath;
          } else {
            // Construct absolute URL from relative path
            const url = new URL(relativePath, baseUrl);
            fullUrl = url.href;
          }
          urls.push(fullUrl);
        } catch (e) {
          console.error(`Invalid URL found: ${relativePath}`);
        }
      }
    }

    return [...new Set(urls)];
  }
}
