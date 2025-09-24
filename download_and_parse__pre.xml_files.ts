import { DOMParser } from "xmldom";
import * as fs from "fs";
import * as path from "path";
import Bun from "bun";

// Interface definitions for filings and XBRL data structures
interface Filing {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
}

interface XBRLTag {
  tag: string;
  label: string;
  datatype?: string;
  abstract?: boolean;
  parentTag?: string;
}

interface XBRLFact {
  concept: string;
  value: string | number;
  contextRef: string;
  unitRef?: string;
  decimals?: string;
  label?: string;
}

interface XBRLContext {
  id: string;
  entityIdentifier: string;
  period: {
    instant?: string;
    startDate?: string;
    endDate?: string;
  };
  dimensions?: { [key: string]: string };
}

interface ExtractedData {
  companyName: string;
  cik: string;
  filingDate: string;
  formType: string;
  facts: XBRLFact[];
  contexts: { [id: string]: XBRLContext };
  tags: { [tag: string]: XBRLTag };
}

class ComprehensiveXBRLProcessor {
  private lastRequestTime: number;
  private readonly minDelay: number;
  private downloadedCount: number;
  private skippedCount: number;

  constructor() {
    this.lastRequestTime = 0;
    this.minDelay = 150; // Minimum delay of 150ms between requests to respect SEC rate limits (under 10 req/sec)
    this.downloadedCount = 0;
    this.skippedCount = 0;
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
  private async fetchDocument(url: string): Promise<string> {
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
   * Creates the local directory structure for storing filings.
   */
  private createDirectoryStructure(
    cik: string,
    formType: string,
    filingDate: string
  ): string {
    const baseDir = "downloads";
    const companyDir = path.join(baseDir, `CIK_${cik}`);
    const formDir = path.join(companyDir, formType);
    const dateDir = path.join(formDir, filingDate);

    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }

    return dateDir;
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
  private findXBRLFiles(content: string, baseUrl: string): string[] {
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

  /**
   * Downloads a single file and saves it to a directory.
   * @returns True if the file was downloaded, false otherwise.
   */
  private async downloadFile(url: string, outputDir: string): Promise<boolean> {
    const filename = url.substring(url.lastIndexOf("/") + 1);
    const filepath = path.join(outputDir, filename);

    if (fs.existsSync(filepath)) {
      console.log(`  Skipping ${filename} (already exists)`);
      this.skippedCount++;
      return false;
    }

    console.log(`  Downloading ${filename}`);
    try {
      const fileContent = await this.fetchDocument(url);
      await Bun.write(filepath, fileContent);
      console.log(`  Successfully saved ${filename}`);
      this.downloadedCount++;
      return true;
    } catch (error) {
      console.error(`  Failed to download ${filename}: ${error}`);
      return false;
    }
  }

  /**
   * Finds and downloads all necessary XBRL files for a given filing.
   * @returns The number of files successfully downloaded.
   */
  private async downloadXBRLFiles(
    filing: Filing,
    cik: string,
    outputDir: string
  ): Promise<number> {
    const cikWithoutLeadingZeros = cik.replace(/^0+/, "");
    const accessionNumber = filing.accessionNumber.replace(/-/g, "");
    const filingIndexUrl = `https://www.sec.gov/Archives/edgar/data/${cikWithoutLeadingZeros}/${accessionNumber}/${filing.accessionNumber}-index.html`;

    console.log(`Processing filing index: ${filingIndexUrl}`);

    try {
      const indexContent = await this.fetchDocument(filingIndexUrl);
      const xbrlFileUrls = this.findXBRLFiles(indexContent, filingIndexUrl);

      if (xbrlFileUrls.length === 0) {
        console.log("  No XBRL files found");
        return 0;
      }

      console.log(`  Found ${xbrlFileUrls.length} XBRL files to download:`);
      xbrlFileUrls.forEach((url) => {
        const filename = url.substring(url.lastIndexOf("/") + 1);
        console.log(`    -> ${filename}`);
      });

      let downloadedFiles = 0;
      for (const fileUrl of xbrlFileUrls) {
        const downloaded = await this.downloadFile(fileUrl, outputDir);
        if (downloaded) downloadedFiles++;
      }

      return downloadedFiles;
    } catch (error) {
      console.error(`  Failed to process ${filingIndexUrl}: ${error}`);
      return 0;
    }
  }

  /**
   * Parses the presentation file to build a structure of XBRL tags.
   */
  private parsePreFile(preXmlContent: string): { [tag: string]: XBRLTag } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(preXmlContent, "application/xml");
    const tags: { [tag: string]: XBRLTag } = {};

    const presentationLinks = doc.getElementsByTagName("presentationLink");

    for (let i = 0; i < presentationLinks.length; i++) {
      const link = presentationLinks[i];
      const locs = link.getElementsByTagName("loc");
      const arcs = link.getElementsByTagName("presentationArc");

      const locMap: { [label: string]: string } = {};
      for (let j = 0; j < locs.length; j++) {
        const loc = locs[j];
        const href = loc.getAttribute("xlink:href");
        const label = loc.getAttribute("xlink:label");
        if (href && label) {
          locMap[label] = href.split("#")[1];
        }
      }

      for (let j = 0; j < arcs.length; j++) {
        const arc = arcs[j];
        const from = arc.getAttribute("xlink:from");
        const to = arc.getAttribute("xlink:to");

        if (from && to && locMap[to]) {
          const tagName = locMap[to];
          if (tagName) {
            tags[tagName] = {
              tag: tagName,
              label: tagName, // Default label
              parentTag: from && locMap[from] ? locMap[from] : undefined,
            };
          }
        }
      }
    }
    return tags;
  }

  /**
   * Parses the label file to get human-readable labels for tags.
   */
  private parseLabFile(
    labXmlContent: string,
    tags: { [tag: string]: XBRLTag }
  ): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(labXmlContent, "application/xml");
    const labelElements = doc.getElementsByTagName("label");

    for (let i = 0; i < labelElements.length; i++) {
      const label = labelElements[i];
      const labelId = label.getAttribute("xlink:label");
      const text = label.textContent?.trim();
      const role = label.getAttribute("xlink:role");

      if (labelId && text && role === "http://www.xbrl.org/2003/role/label") {
        const tagName = labelId.replace("lab_", "");
        if (tags[tagName]) {
          tags[tagName].label = text;
        }
      }
    }
  }

  /**
   * Parses the instance file to extract facts and contexts.
   */
  private parseInstanceFile(instanceXmlContent: string): {
    facts: XBRLFact[];
    contexts: { [id: string]: XBRLContext };
  } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(instanceXmlContent, "application/xml");
    const facts: XBRLFact[] = [];
    const contexts: { [id: string]: XBRLContext } = {};

    const contextElements = doc.getElementsByTagName("context");
    for (let i = 0; i < contextElements.length; i++) {
      const context = contextElements[i];
      const id = context.getAttribute("id");

      if (id) {
        const entity = context.getElementsByTagName("identifier")[0];
        const entityId = entity?.textContent || "";

        const instant = context.getElementsByTagName("instant")[0]?.textContent;
        const startDate =
          context.getElementsByTagName("startDate")[0]?.textContent;
        const endDate = context.getElementsByTagName("endDate")[0]?.textContent;

        contexts[id] = {
          id,
          entityIdentifier: entityId,
          period: { instant, startDate, endDate },
        };
      }
    }

    // Use getElementsByTagName('*') to robustly get all elements, not just direct children of the root.
    const allElements = doc.getElementsByTagName("*");
    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i];

      const contextRef = element.getAttribute("contextRef");
      const unitRef = element.getAttribute("unitRef");
      const decimals = element.getAttribute("decimals");

      if (contextRef) {
        const concept = element.nodeName;
        const value = element.textContent?.trim() || "";

        if (
          concept.includes(":") &&
          !concept.startsWith("xbrli:") &&
          !concept.startsWith("link:") &&
          !concept.startsWith("xlink:")
        ) {
          let numericValue: string | number = value;
          if (/^-?\d+(\.\d+)?$/.test(value)) {
            numericValue = parseFloat(value);
          }

          facts.push({
            concept: concept.split(":")[1] || concept,
            value: numericValue,
            contextRef,
            unitRef: unitRef || undefined,
            decimals: decimals || undefined,
          });
        }
      }
    }

    return { facts, contexts };
  }

  /**
   * Extracts data from a local directory of downloaded XBRL files.
   */
  private extractFromDirectory(directoryPath: string): ExtractedData | null {
    try {
      const files = fs.readdirSync(directoryPath);

      const preFile = files.find((f) => f.includes("_pre.xml"));
      const labFile = files.find((f) => f.includes("_lab.xml"));
      // Robustly find the instance file: it's the .xml file that ISN'T a known linkbase type.
      const instanceFile = files.find(
        (f) =>
          f.endsWith(".xml") &&
          !f.includes("_pre.xml") &&
          !f.includes("_cal.xml") &&
          !f.includes("_def.xml") &&
          !f.includes("_lab.xml")
      );

      // Add clearer, more detailed logging for when essential files are missing.
      if (!preFile || !instanceFile) {
        console.warn(
          `  - WARNING: Could not find all required XBRL files in ${directoryPath}.`
        );
        if (!preFile)
          console.warn(`    - Missing: Presentation file (_pre.xml)`);
        if (!instanceFile)
          console.warn(`    - Missing: Main instance file (.xml)`);
        console.error(
          "  - SKIPPING EXTRACTION for this filing due to missing files."
        );
        return null;
      }

      console.log(`  Processing XBRL files:`);
      console.log(`    - Presentation: ${preFile}`);
      console.log(`    - Label: ${labFile || "NOT FOUND"}`);
      console.log(`    - Instance: ${instanceFile}`);

      const preContent = fs.readFileSync(
        path.join(directoryPath, preFile),
        "utf-8"
      );
      const instanceContent = fs.readFileSync(
        path.join(directoryPath, instanceFile),
        "utf-8"
      );

      const tags = this.parsePreFile(preContent);
      if (labFile) {
        const labContent = fs.readFileSync(
          path.join(directoryPath, labFile),
          "utf-8"
        );
        this.parseLabFile(labContent, tags);
      }

      const { facts, contexts } = this.parseInstanceFile(instanceContent);

      facts.forEach((fact) => {
        if (tags[fact.concept]) {
          fact.label = tags[fact.concept].label;
        }
      });

      const pathParts = directoryPath.split(path.sep);
      const cik =
        pathParts.find((p) => p.startsWith("CIK_"))?.replace("CIK_", "") || "";
      const formType = pathParts[pathParts.length - 2] || "";
      const filingDate = pathParts[pathParts.length - 1] || "";

      return {
        companyName: "",
        cik,
        filingDate,
        formType,
        facts,
        contexts,
        tags,
      };
    } catch (error) {
      console.error(`  Error extracting data from ${directoryPath}:`, error);
      return null;
    }
  }

  /**
   * Generates a human-readable report from extracted data.
   */
  public generateReport(data: ExtractedData): string {
    const report = [];

    report.push("=".repeat(80));
    report.push(`XBRL DATA EXTRACTION REPORT`);
    report.push("=".repeat(80));
    report.push(`CIK: ${data.cik}`);
    report.push(`Form Type: ${data.formType}`);
    report.push(`Filing Date: ${data.filingDate}`);
    report.push(`Total Facts: ${data.facts.length}`);
    report.push(`Total Contexts: ${Object.keys(data.contexts).length}`);
    report.push(`Total Tags: ${Object.keys(data.tags).length}`);
    report.push("");

    report.push("KEY FINANCIAL METRICS:");
    report.push("-".repeat(50));

    const importantMetrics = [
      "Assets",
      "Liabilities",
      "StockholdersEquity",
      "Revenues",
      "NetIncomeLoss",
      "EarningsPerShareBasic",
      "CashAndCashEquivalentsAtCarryingValue",
      "OperatingIncomeLoss",
    ];

    const reportedMetrics = new Set();

    for (const metric of importantMetrics) {
      const fact = data.facts.find((f) => f.concept === metric);
      if (fact && !reportedMetrics.has(metric)) {
        const context = data.contexts[fact.contextRef];
        const period =
          context.period.instant ||
          `${context.period.startDate} to ${context.period.endDate}`;
        const formattedValue =
          typeof fact.value === "number"
            ? fact.value.toLocaleString()
            : fact.value;
        report.push(
          `${fact.label || fact.concept}: ${formattedValue} (Period: ${period})`
        );
        reportedMetrics.add(metric);
      }
    }

    report.push("");
    report.push("SAMPLE OF ALL EXTRACTED FACTS (up to 15):");
    report.push("-".repeat(50));

    data.facts.slice(0, 15).forEach((fact) => {
      const formattedValue =
        typeof fact.value === "number"
          ? fact.value.toLocaleString()
          : fact.value;
      report.push(`  ${fact.label || fact.concept}: ${formattedValue}`);
    });

    if (data.facts.length > 15) {
      report.push(`  ... and ${data.facts.length - 15} more facts.`);
    }

    return report.join("\n");
  }

  /**
   * Exports extracted data to a JSON file.
   */
  public exportToJSON(data: ExtractedData, outputPath: string): void {
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(outputPath, jsonData, "utf-8");
    console.log(`Data exported to: ${outputPath}`);
  }

  /**
   * Exports extracted data to a CSV file.
   */
  public exportToCSV(data: ExtractedData, outputPath: string): void {
    const csvLines = ["Concept,Label,Value,ContextRef,UnitRef,Decimals,Period"];

    data.facts.forEach((fact) => {
      const context = data.contexts[fact.contextRef];
      const period =
        context.period.instant ||
        `${context.period.startDate || ""}-${context.period.endDate || ""}`;

      const line = [
        fact.concept,
        `"${(fact.label || "").replace(/"/g, '""')}"`, // Escape double quotes in labels
        fact.value,
        fact.contextRef,
        fact.unitRef || "",
        fact.decimals || "",
        period,
      ].join(",");

      csvLines.push(line);
    });

    fs.writeFileSync(outputPath, csvLines.join("\n"), "utf-8");
    console.log(`CSV exported to: ${outputPath}`);
  }

  /**
   * Downloads and extracts data for a specific filing.
   */
  public async processSpecificFiling(
    cik: string,
    accessionNumber: string
  ): Promise<ExtractedData | null> {
    console.log(`\n=== Processing specific filing: ${accessionNumber} ===`);

    try {
      const allFilings = await this.getAllFilings(cik);
      const filing = allFilings.find(
        (f) => f.accessionNumber === accessionNumber
      );

      if (!filing) {
        console.error(
          `Filing with accession number ${accessionNumber} not found for CIK ${cik}`
        );
        return null;
      }

      console.log(`Found filing: ${filing.form} filed on ${filing.filingDate}`);

      const outputDir = this.createDirectoryStructure(
        cik,
        filing.form,
        filing.filingDate
      );
      const downloadedFiles = await this.downloadXBRLFiles(
        filing,
        cik,
        outputDir
      );

      if (downloadedFiles === 0) {
        console.warn("No new XBRL files were downloaded for this filing.");
      }

      const extractedData = this.extractFromDirectory(outputDir);
      return extractedData;
    } catch (error) {
      console.error(`Failed to process filing: ${error}`);
      return null;
    }
  }

  /**
   * Processes multiple filings for a company, with options for filtering and extraction.
   */
  public async processCompanyFilings(
    cik: string,
    formTypes?: string[],
    maxFilings?: number,
    extractData: boolean = true
  ): Promise<void> {
    console.log(`\n=== Processing company filings for CIK: ${cik} ===`);
    if (formTypes) {
      console.log(`Filtering for form types: ${formTypes.join(", ")}`);
    }

    this.downloadedCount = 0;
    this.skippedCount = 0;

    try {
      const allFilings = await this.getAllFilings(cik, formTypes);
      if (allFilings.length === 0) {
        console.log("No filings found matching criteria.");
        return;
      }

      const filingsToProcess = maxFilings
        ? allFilings.slice(0, maxFilings)
        : allFilings;
      console.log(
        `Found ${allFilings.length} total filings. Processing up to ${filingsToProcess.length}...\n`
      );

      for (let i = 0; i < filingsToProcess.length; i++) {
        const filing = filingsToProcess[i];
        const progress = `[${i + 1}/${filingsToProcess.length}]`;
        console.log(
          `${progress} Processing ${filing.form} filed on ${filing.filingDate}`
        );

        const outputDir = this.createDirectoryStructure(
          cik,
          filing.form,
          filing.filingDate
        );
        await this.downloadXBRLFiles(filing, cik, outputDir);

        if (extractData) {
          console.log(`  Extracting data...`);
          const extractedData = this.extractFromDirectory(outputDir);

          if (extractedData) {
            const baseFileName = `${cik}_${filing.form}_${filing.filingDate}`;
            const jsonPath = path.join(outputDir, `${baseFileName}_data.json`);
            const csvPath = path.join(outputDir, `${baseFileName}_data.csv`);

            this.exportToJSON(extractedData, jsonPath);
            this.exportToCSV(extractedData, csvPath);

            console.log(
              `  ✓ Data extracted and exported for ${filing.filingDate}`
            );
          } else {
            console.log(`  ✗ Data extraction failed for ${filing.filingDate}`);
          }
        }

        console.log(); // Newline for readability
      }

      console.log(`\n=== Processing Complete ===`);
      console.log(`Total files downloaded: ${this.downloadedCount}`);
      console.log(
        `Total files skipped (already existed): ${this.skippedCount}`
      );
      console.log(`Files are organized in: ./downloads/CIK_${cik}/`);
    } catch (error) {
      console.error(`Processing failed: ${error}`);
    }
  }

  /**
   * Reprocesses already downloaded XBRL files to re-extract data.
   */
  public async reprocessDownloadedFiles(cik: string): Promise<void> {
    console.log(`\n=== Re-processing downloaded files for CIK: ${cik} ===`);

    const companyDir = `./downloads/CIK_${cik}`;

    if (!fs.existsSync(companyDir)) {
      console.error(
        `No downloaded files found for CIK: ${cik}. Run a download process first.`
      );
      return;
    }

    const formDirs = fs.readdirSync(companyDir);
    let processedCount = 0;

    for (const formDir of formDirs) {
      const formPath = path.join(companyDir, formDir);
      if (!fs.statSync(formPath).isDirectory()) continue;

      const dateDirs = fs.readdirSync(formPath);
      for (const dateDir of dateDirs) {
        const datePath = path.join(formPath, dateDir);

        if (!fs.statSync(datePath).isDirectory()) continue;

        console.log(`\nRe-processing: ${formDir} - ${dateDir}`);

        const extractedData = this.extractFromDirectory(datePath);
        if (extractedData) {
          console.log(this.generateReport(extractedData));

          const baseFileName = `${cik}_${formDir}_${dateDir}`;
          const jsonPath = path.join(datePath, `${baseFileName}_data.json`);
          const csvPath = path.join(datePath, `${baseFileName}_data.csv`);

          this.exportToJSON(extractedData, jsonPath);
          this.exportToCSV(extractedData, csvPath);

          console.log(`  ✓ Re-processed and exported data.`);
          processedCount++;
        }
      }
    }

    console.log(`\n=== Re-processing Complete ===`);
    console.log(`Total filings re-processed: ${processedCount}`);
  }
}

/**
 * Main function to run the XBRL processor.
 */
async function main() {
  const processor = new ComprehensiveXBRLProcessor();

  // The CIK for the company you want to process.
  const cikToProcess = "1409493";

  // Define which form types to download (e.g., '10-K' for annual, '10-Q' for quarterly).
  const formTypesToProcess = ["10-K", "10-Q"];

  // Set the maximum number of recent filings to process.
  const maxFilingsToProcess = 8;

  // This will download the filings, extract the data, and save it as JSON and CSV.
  await processor.processCompanyFilings(
    cikToProcess,
    formTypesToProcess,
    maxFilingsToProcess
  );

  // --- ALTERNATIVE ACTIONS (uncomment to use) ---

  // To process a single, specific filing by its accession number:
  // const accessionNumber = "0001193125-23-020473"; // Example accession number
  // const data = await processor.processSpecificFiling(cikToProcess, accessionNumber);
  // if (data) {
  //   console.log(processor.generateReport(data));
  // }

  // To re-process files you have already downloaded without re-downloading:
  // await processor.reprocessDownloadedFiles(cikToProcess);
}

// Execute the main function
main().catch((error) => {
  console.error("An unexpected error occurred in the main function:", error);
});
