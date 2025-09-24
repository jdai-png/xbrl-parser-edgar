import * as fs from "fs";
import * as path from "path";
import { SecApi } from "../../sec_api";
import { FileManager } from "./file_manager";
import { DataExtractor } from "./data_extractor";
import { Reporting } from "../../reporting";
import { type ExtractedData } from "../types";

/**
 * Orchestrates the entire process of fetching, downloading, and processing filings.
 */
export class ComprehensiveXBRLProcessor {
  private secApi: SecApi;
  private fileManager: FileManager;
  private dataExtractor: DataExtractor;
  private reporting: Reporting;

  constructor(
    secApi: SecApi,
    fileManager: FileManager,
    dataExtractor: DataExtractor,
    reporting: Reporting
  ) {
    this.secApi = secApi;
    this.fileManager = fileManager;
    this.dataExtractor = dataExtractor;
    this.reporting = reporting;
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
      const allFilings = await this.secApi.getAllFilings(cik);
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

      const outputDir = this.fileManager.createDirectoryStructure(
        cik,
        filing.form,
        filing.filingDate
      );
      const downloadedFiles = await this.fileManager.downloadXBRLFiles(
        filing,
        cik,
        outputDir
      );

      if (downloadedFiles === 0) {
        console.warn("No new XBRL files were downloaded for this filing.");
      }

      const extractedData = this.dataExtractor.extractFromDirectory(outputDir);
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

    this.fileManager.downloadedCount = 0;
    this.fileManager.skippedCount = 0;

    try {
      const allFilings = await this.secApi.getAllFilings(cik, formTypes);
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

        const outputDir = this.fileManager.createDirectoryStructure(
          cik,
          filing.form,
          filing.filingDate
        );
        await this.fileManager.downloadXBRLFiles(filing, cik, outputDir);

        if (extractData) {
          console.log(`  Extracting data...`);
          const extractedData =
            this.dataExtractor.extractFromDirectory(outputDir);

          if (extractedData) {
            const baseFileName = `${cik}_${filing.form}_${filing.filingDate}`;
            const jsonPath = path.join(outputDir, `${baseFileName}_data.json`);
            const csvPath = path.join(outputDir, `${baseFileName}_data.csv`);

            this.reporting.exportToJSON(extractedData, jsonPath);
            this.reporting.exportToCSV(extractedData, csvPath);

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
      console.log(
        `Total files downloaded: ${this.fileManager.downloadedCount}`
      );
      console.log(
        `Total files skipped (already existed): ${this.fileManager.skippedCount}`
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

        const extractedData = this.dataExtractor.extractFromDirectory(datePath);
        if (extractedData) {
          console.log(this.reporting.generateReport(extractedData));

          const baseFileName = `${cik}_${formDir}_${dateDir}`;
          const jsonPath = path.join(datePath, `${baseFileName}_data.json`);
          const csvPath = path.join(datePath, `${baseFileName}_data.csv`);

          this.reporting.exportToJSON(extractedData, jsonPath);
          this.reporting.exportToCSV(extractedData, csvPath);

          console.log(`  ✓ Re-processed and exported data.`);
          processedCount++;
        }
      }
    }

    console.log(`\n=== Re-processing Complete ===`);
    console.log(`Total filings re-processed: ${processedCount}`);
  }
}
