import * as fs from "fs";
import { type ExtractedData } from "./types";

/**
 * Generates reports and exports data to various formats.
 */
export class Reporting {
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
}
