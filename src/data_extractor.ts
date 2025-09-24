import * as fs from "fs";
import * as path from "path";
import { type ExtractedData } from "../types";
import type { XbrlParser } from "./xbrl_parser";

/**
 * Extracts structured data from a directory of downloaded XBRL files.
 */
export class DataExtractor {
  private xbrlParser: XbrlParser;

  constructor(xbrlParser: XbrlParser) {
    this.xbrlParser = xbrlParser;
  }

  /**
   * Extracts data from a local directory of downloaded XBRL files.
   */
  public extractFromDirectory(directoryPath: string): ExtractedData | null {
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

      const tags = this.xbrlParser.parsePreFile(preContent);
      if (labFile) {
        const labContent = fs.readFileSync(
          path.join(directoryPath, labFile),
          "utf-8"
        );
        this.xbrlParser.parseLabFile(labContent, tags);
      }

      const { facts, contexts } =
        this.xbrlParser.parseInstanceFile(instanceContent);

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
}
