import * as fs from "fs";
import * as path from "path";
import Bun from "bun";
import { SecApi } from "./sec_api";
import { type Filing } from "./types";

/**
 * Manages file system operations like creating directories and downloading files.
 */
export class FileManager {
  private secApi: SecApi;
  public downloadedCount: number;
  public skippedCount: number;

  constructor(secApi: SecApi) {
    this.secApi = secApi;
    this.downloadedCount = 0;
    this.skippedCount = 0;
  }

  /**
   * Creates the local directory structure for storing filings.
   */
  public createDirectoryStructure(
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
      const fileContent = await this.secApi.fetchDocument(url);
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
  public async downloadXBRLFiles(
    filing: Filing,
    cik: string,
    outputDir: string
  ): Promise<number> {
    const cikWithoutLeadingZeros = cik.replace(/^0+/, "");
    const accessionNumber = filing.accessionNumber.replace(/-/g, "");
    const filingIndexUrl = `https://www.sec.gov/Archives/edgar/data/${cikWithoutLeadingZeros}/${accessionNumber}/${filing.accessionNumber}-index.html`;

    console.log(`Processing filing index: ${filingIndexUrl}`);

    try {
      const indexContent = await this.secApi.fetchDocument(filingIndexUrl);
      const xbrlFileUrls = this.secApi.findXBRLFiles(
        indexContent,
        filingIndexUrl
      );

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
}
