import { ComprehensiveXBRLProcessor } from "./file_processor";
import { SecApi } from "./sec_api";
import { FileManager } from "./file_manager";
import { XbrlParser } from "./xbrl_parser";
import { DataExtractor } from "./data_extractor";
import { Reporting } from "./reporting";

/**
 * Main function to run the XBRL processor.
 */
async function main() {
  // Instantiate all the modules
  const secApi = new SecApi();
  const fileManager = new FileManager(secApi);
  const xbrlParser = new XbrlParser();
  const dataExtractor = new DataExtractor(xbrlParser);
  const reporting = new Reporting();
  const processor = new ComprehensiveXBRLProcessor(
    secApi,
    fileManager,
    dataExtractor,
    reporting
  );

  const strings =
    // "858877, 72971, 2488, 353278, 1413329, 1094517, 895421, 901832, 51143, 1089113, 886982, 1114448, 2070829, 1800, 1067839, 1108524, 4962, 1393818, 1707925, 63908, 1306965, 101829, 732717, 1744489, 18230, 1751008, 1000275, 310158, 1543151, 1373715, 77476, 831001, 97745, 732712, 1737806, 896878, 97476, 1594805, 1144967, 1596532, 723125, 1075531, 67088, 804328, 2012383, 946770, 316709, 1996810, 64040, 1973239, 12927, 313838, 1035267, 217410, 109198, 707549, 60667, 796343, 891478, 310764, 1467373, 318154, 885725, 820313, 1551182, 753308, 80661, 927628, 1639920, 6951, 882095, 811809, 879764, 313616, 78003, 1327567, 773840, 1404912, 100885, 319201, 2046954, 947263, 315189, 1610520, 47710, 887028, 1303523, 1099590, 1613103, 1121404, 6281, 1166691, 1163165, 50863, 8670, 1103838, 1668717, 1703399, 1792789, 766704, 1535527, 936468, 842180, 883241, 764180, 896159, 320187, 895728, 1381197, 1045609, 1022837, 1001085, 1783879, 875320, 92122, 1868275, 863064, 1110646, 1571949, 62709, 76334, 813672, 1050446, 1937926, 14272";
    "1506307, 1178670, 1297996, 1276187, 1385157, 1446250, 16868, 92230, 1835632, 872589, 1069183, 1176948, 844150, 1769628, 4977, 26172";
  // "823768, 89800, 898173, 313807, 1222333, 40533, 1164727, 927653, 1001838, 1571996, 1648416, 929869, 1679788, 66740, 1133421, 1131399, 1335730, 1103982, 895564, 9631, 723254, 1858681, 1075124, 68505, 713676, 1119639, 1739940, 2039784, 1640147, 315293, 1691493, 2809, 1477333, 49826, 1101239, 4281, 849395, 36104, 31462, 1039765, 354190, 1045520, 1559720, 1390777, 1260221, 1048286, 32604, 312069, 798354, 1090727, 1067491, 1060391, 1158838, 1132597, 866787, 1159508, 1004315, 833444, 16875, 1156039, 107263, 1061219, 1017413, 769397, 1555280, 1160106, 1278680, 24741, 1063761, 821189, 21665, 831259, 865752, 1585689, 1633917, 1588489, 2969, 1692819, 702165, 1140625, 1129137, 1067701, 86312, 1262039, 1327811, 1834584, 277948";
  // An array of CIKs for the companies you want to process.

  // const ciksToProcess = ["1409493", "320193", "789019"]; // Example: [BlackRock, Apple, Microsoft]
  const ciksToProcess = strings.split(", ").map((el) => el.trim());

  // Define which form types to download (e.g., '10-K' for annual, '10-Q' for quarterly).
  //const formTypesToProcess = ["144"];

  // const formTypesToProcess = ["10-K", "10-Q"];
  const formTypesToProcess = ["10-K"];

  // Set the maximum number of recent filings to process for each company.
  const maxFilingsToProcess = 4;

  // Loop through each CIK and process its filings.
  for (const cik of ciksToProcess) {
    // This will download the filings, extract the data, and save it as JSON and CSV.
    await processor.processCompanyFilings(
      cik,
      formTypesToProcess,
      maxFilingsToProcess
    );
  }

  // --- ALTERNATIVE ACTIONS (uncomment to use for a single CIK) ---

  // To process a single, specific filing by its accession number:
  // const singleCik = "320193"; // Example CIK
  // const accessionNumber = "0000320193-23-000106"; // Example accession number for Apple
  // const data = await processor.processSpecificFiling(singleCik, accessionNumber);
  // if (data) {
  //   console.log(reporting.generateReport(data));
  // }

  // To re-process files you have already downloaded without re-downloading for a single CIK:
  // const singleCikToReprocess = "789019"; // Example CIK
  // await processor.reprocessDownloadedFiles(singleCikToReprocess);
}

// Execute the main function
main().catch((error) => {
  console.error("An unexpected error occurred in the main function:", error);
});
