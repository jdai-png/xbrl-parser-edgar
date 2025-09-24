import { DOMParser } from "xmldom";
import * as fs from "fs";
import * as path from "path";

// Interface definitions for filing and XBRL data structures
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
		this.minDelay = 150; // Rate limiting
		this.downloadedCount = 0;
		this.skippedCount = 0;
	}

	private async waitForRateLimit(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;
		if (timeSinceLastRequest < this.minDelay) {
			const waitTime = this.minDelay - timeSinceLastRequest;
			await Bun.sleep(waitTime);
		}
		this.lastRequestTime = Date.now();
	}

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

	// =================== DOWNLOADER METHODS ===================

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

	public async getAllFilings(
		cik: string,
		formTypes?: string[]
	): Promise<Filing[]> {
		console.log(`Fetching all filings for CIK: ${cik}`);
		const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;

		try {
			const data = await this.fetchDocument(submissionsUrl);
			const submissions = JSON.parse(data);
			const allFilings: Filing[] = [];

			// Process recent filings
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

			// Process historical filings
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

	private findXBRLFiles(content: string, baseUrl: string): string[] {
		const xbrlRegex = /href\s*=\s*["']([^"']*\.(?:xml|xsd))["']/gi;
		const urls: string[] = [];
		let match;

		while ((match = xbrlRegex.exec(content)) !== null) {
			const relativePath = match[1];

			// Filter for XBRL files we need
			if (
				relativePath.includes("_pre.xml") ||
				relativePath.includes("_cal.xml") ||
				relativePath.includes("_def.xml") ||
				relativePath.includes("_lab.xml") ||
				relativePath.match(/[a-z]+-\d{8}\.xml$/) // Instance files
			) {
				try {
					let fullUrl: string;
					if (relativePath.startsWith("http")) {
						fullUrl = relativePath;
					} else {
						let cleanPath = relativePath;
						if (cleanPath.startsWith("../")) cleanPath = cleanPath.substring(3);
						if (cleanPath.startsWith("./")) cleanPath = cleanPath.substring(2);
						if (cleanPath.startsWith("/")) cleanPath = cleanPath.substring(1);

						if (cleanPath.includes("Archives/edgar/data/")) {
							fullUrl = "https://www.sec.gov/" + cleanPath;
						} else {
							const baseUrlParts = baseUrl.split("/");
							baseUrlParts.pop();
							fullUrl = baseUrlParts.join("/") + "/" + cleanPath;
						}
					}
					urls.push(fullUrl);
				} catch (e) {
					console.error(`Invalid URL found: ${relativePath}`);
				}
			}
		}

		return [...new Set(urls)];
	}

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

			console.log(`  Found ${xbrlFileUrls.length} XBRL files`);

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

	// =================== EXTRACTOR METHODS ===================

	private parsePreFile(preXmlContent: string): { [tag: string]: XBRLTag } {
		const parser = new DOMParser();
		const doc = parser.parseFromString(preXmlContent, "application/xml");
		const tags: { [tag: string]: XBRLTag } = {};

		const presentationLinks = doc.getElementsByTagName("presentationLink");

		for (let i = 0; i < presentationLinks.length; i++) {
			const link = presentationLinks[i];
			const locs = link.getElementsByTagName("loc");
			const arcs = link.getElementsByTagName("presentationArc");

			const locMap: { [href: string]: string } = {};
			for (let j = 0; j < locs.length; j++) {
				const loc = locs[j];
				const href = loc.getAttribute("xlink:href");
				const label = loc.getAttribute("xlink:label");
				if (href && label) {
					locMap[label] = href;
				}
			}

			for (let j = 0; j < arcs.length; j++) {
				const arc = arcs[j];
				const from = arc.getAttribute("xlink:from");
				const to = arc.getAttribute("xlink:to");

				if (from && to && locMap[to]) {
					const href = locMap[to];
					const tagName = href.split("#")[1]?.replace(/^[^_]*_/, "");

					if (tagName) {
						tags[tagName] = {
							tag: tagName,
							label: tagName,
							parentTag:
								from && locMap[from]
									? locMap[from].split("#")[1]?.replace(/^[^_]*_/, "")
									: undefined,
						};
					}
				}
			}
		}

		return tags;
	}

	private parseLabFile(labXmlContent: string): { [tag: string]: string } {
		const parser = new DOMParser();
		const doc = parser.parseFromString(labXmlContent, "application/xml");
		const labels: { [tag: string]: string } = {};

		const labelLinks = doc.getElementsByTagName("labelLink");

		for (let i = 0; i < labelLinks.length; i++) {
			const link = labelLinks[i];
			const locs = link.getElementsByTagName("loc");
			const labelElements = link.getElementsByTagName("label");

			const locMap: { [label: string]: string } = {};
			for (let j = 0; j < locs.length; j++) {
				const loc = locs[j];
				const href = loc.getAttribute("xlink:href");
				const label = loc.getAttribute("xlink:label");
				if (href && label) {
					locMap[label] = href;
				}
			}

			for (let j = 0; j < labelElements.length; j++) {
				const label = labelElements[j];
				const labelFor = label.getAttribute("xlink:label");
				const role = label.getAttribute("xlink:role");
				const text = label.textContent;

				if (labelFor && text && role && role.includes("label")) {
					for (const [locLabel, href] of Object.entries(locMap)) {
						if (href.includes(labelFor.replace("_label", ""))) {
							const tagName = href.split("#")[1]?.replace(/^[^_]*_/, "");
							if (tagName) {
								labels[tagName] = text.trim();
							}
							break;
						}
					}
				}
			}
		}

		return labels;
	}

	private parseInstanceFile(instanceXmlContent: string): {
		facts: XBRLFact[];
		contexts: { [id: string]: XBRLContext };
	} {
		const parser = new DOMParser();
		const doc = parser.parseFromString(instanceXmlContent, "application/xml");
		const facts: XBRLFact[] = [];
		const contexts: { [id: string]: XBRLContext } = {};

		// Parse contexts
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

		// Parse facts
		const allElements = doc.documentElement.childNodes;
		for (let i = 0; i < allElements.length; i++) {
			const element = allElements[i];

			if (element.nodeType === 1) {
				const contextRef = (element as any).getAttribute("contextRef");
				const unitRef = (element as any).getAttribute("unitRef");
				const decimals = (element as any).getAttribute("decimals");

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
						if (/^-?\d+\.?\d*$/.test(value)) {
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
		}

		return { facts, contexts };
	}

	private extractFromDirectory(directoryPath: string): ExtractedData | null {
		try {
			const files = fs.readdirSync(directoryPath);

			const preFile = files.find((f) => f.includes("_pre.xml"));
			const labFile = files.find((f) => f.includes("_lab.xml"));
			const instanceFile = files.find((f) => f.match(/^[a-z]+-\d{8}\.xml$/));

			if (!preFile || !instanceFile) {
				console.warn(`  Missing required files in ${directoryPath}`);
				console.warn(`  Pre file: ${preFile || "NOT FOUND"}`);
				console.warn(`  Instance file: ${instanceFile || "NOT FOUND"}`);
				console.warn(`  Available files: ${files.join(", ")}`);
				return null;
			}

			console.log(`  Processing XBRL files:`);
			console.log(`    - Pre file: ${preFile}`);
			console.log(`    - Lab file: ${labFile || "NOT FOUND"}`);
			console.log(`    - Instance file: ${instanceFile}`);

			// Read and parse files
			const preContent = fs.readFileSync(
				path.join(directoryPath, preFile),
				"utf-8"
			);
			const instanceContent = fs.readFileSync(
				path.join(directoryPath, instanceFile),
				"utf-8"
			);

			let labContent = "";
			if (labFile) {
				labContent = fs.readFileSync(
					path.join(directoryPath, labFile),
					"utf-8"
				);
			}

			const tags = this.parsePreFile(preContent);
			const labels = labFile ? this.parseLabFile(labContent) : {};
			const { facts, contexts } = this.parseInstanceFile(instanceContent);

			// Enhance tags with labels
			for (const [tag, tagInfo] of Object.entries(tags)) {
				if (labels[tag]) {
					tagInfo.label = labels[tag];
				}
			}

			// Enhance facts with labels
			facts.forEach((fact) => {
				if (tags[fact.concept]) {
					fact.label = tags[fact.concept].label;
				}
			});

			// Extract metadata from directory path
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

		// Group facts by concept
		const factsByConcept: { [concept: string]: XBRLFact[] } = {};
		data.facts.forEach((fact) => {
			if (!factsByConcept[fact.concept]) {
				factsByConcept[fact.concept] = [];
			}
			factsByConcept[fact.concept].push(fact);
		});

		report.push("KEY FINANCIAL METRICS:");
		report.push("-".repeat(50));

		// Look for common financial metrics
		const importantMetrics = [
			"Assets",
			"Liabilities",
			"StockholdersEquity",
			"Revenue",
			"Revenues",
			"NetIncome",
			"Cash",
			"CurrentAssets",
			"CurrentLiabilities",
			"TotalAssets",
			"CashAndCashEquivalentsAtCarryingValue",
			"RetainedEarnings",
		];

		for (const metric of importantMetrics) {
			const matchingFacts = data.facts.filter((f) =>
				f.concept.toLowerCase().includes(metric.toLowerCase())
			);

			if (matchingFacts.length > 0) {
				// Get the most recent fact (assuming contexts are sorted)
				const fact = matchingFacts[0];
				const context = data.contexts[fact.contextRef];
				const period =
					context.period.instant ||
					`${context.period.startDate} to ${context.period.endDate}`;

				const formattedValue =
					typeof fact.value === "number"
						? fact.value.toLocaleString()
						: fact.value;

				report.push(
					`${fact.label || fact.concept}: ${formattedValue} (${period})`
				);
			}
		}

		report.push("");
		report.push("SAMPLE OF ALL EXTRACTED FACTS:");
		report.push("-".repeat(50));

		// Show sample facts grouped by context period
		const factsByPeriod: { [period: string]: XBRLFact[] } = {};

		data.facts.forEach((fact) => {
			const context = data.contexts[fact.contextRef];
			const period =
				context.period.instant ||
				`${context.period.startDate || ""} to ${context.period.endDate || ""}`;

			if (!factsByPeriod[period]) {
				factsByPeriod[period] = [];
			}
			factsByPeriod[period].push(fact);
		});

		for (const [period, facts] of Object.entries(factsByPeriod)) {
			report.push(`\nPeriod: ${period}`);
			facts.slice(0, 10).forEach((fact) => {
				// Limit to first 10 per period
				const formattedValue =
					typeof fact.value === "number"
						? fact.value.toLocaleString()
						: fact.value;
				report.push(`  ${fact.label || fact.concept}: ${formattedValue}`);
			});

			if (facts.length > 10) {
				report.push(`  ... and ${facts.length - 10} more facts`);
			}
		}

		return report.join("\n");
	}

	public exportToJSON(data: ExtractedData, outputPath: string): void {
		const jsonData = JSON.stringify(data, null, 2);
		fs.writeFileSync(outputPath, jsonData, "utf-8");
		console.log(`Data exported to: ${outputPath}`);
	}

	public exportToCSV(data: ExtractedData, outputPath: string): void {
		const csvLines = ["Concept,Label,Value,Context,Unit,Decimals,Period"];

		data.facts.forEach((fact) => {
			const context = data.contexts[fact.contextRef];
			const period =
				context.period.instant ||
				`${context.period.startDate || ""}-${context.period.endDate || ""}`;

			const line = [
				fact.concept,
				`"${fact.label || ""}"`,
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

	// =================== COMPREHENSIVE PROCESSING METHODS ===================

	/**
	 * Download XBRL files and extract data for a specific filing
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
					`Filing with accession number ${accessionNumber} not found`
				);
				return null;
			}

			console.log(`Found filing: ${filing.form} filed on ${filing.filingDate}`);

			// Create directory and download files
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
				console.error("No XBRL files were downloaded");
				return null;
			}

			console.log(`Downloaded ${downloadedFiles} files`);

			// Extract data
			const extractedData = this.extractFromDirectory(outputDir);

			return extractedData;
		} catch (error) {
			console.error(`Failed to process filing: ${error}`);
			return null;
		}
	}

	/**
	 * Process multiple filings for a company
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
			console.log(`Processing ${filingsToProcess.length} filings...\n`);

			for (let i = 0; i < filingsToProcess.length; i++) {
				const filing = filingsToProcess[i];
				const progress = `[${i + 1}/${filingsToProcess.length}]`;
				console.log(`${progress} ${filing.form} filed on ${filing.filingDate}`);

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
					// Remove empty directory
					try {
						fs.rmSync(outputDir, { recursive: true, force: true });
					} catch (e) {
						// Ignore cleanup errors
					}
					continue;
				}

				// Extract data if requested
				if (extractData) {
					console.log(`  Extracting data...`);
					const extractedData = this.extractFromDirectory(outputDir);

					if (extractedData) {
						// Export data
						const baseFileName = `${cik}_${filing.form}_${filing.filingDate}`;
						const jsonPath = path.join(outputDir, `${baseFileName}_data.json`);
						const csvPath = path.join(outputDir, `${baseFileName}_data.csv`);

						this.exportToJSON(extractedData, jsonPath);
						this.exportToCSV(extractedData, csvPath);

						console.log(`  ✓ Data extracted and exported`);
						console.log(`    - Facts: ${extractedData.facts.length}`);
						console.log(
							`    - Contexts: ${Object.keys(extractedData.contexts).length}`
						);
					}
				}

				console.log(); // Add spacing between filings
			}

			console.log(`\n=== Processing Complete ===`);
			console.log(`Total files downloaded: ${this.downloadedCount}`);
			console.log(
				`Total files skipped (already existed): ${this.skippedCount}`
			);
			console.log(`Files organized in: ./downloads/CIK_${cik}/`);
		} catch (error) {
			console.error(`Processing failed: ${error}`);
		}
	}

	/**
	 * Process already downloaded files (re-extract data)
	 */
	public async reprocessDownloadedFiles(cik: string): Promise<void> {
		console.log(`\n=== Re-processing downloaded files for CIK: ${cik} ===`);

		const companyDir = `./downloads/CIK_${cik}`;

		if (!fs.existsSync(companyDir)) {
			console.error(`No downloaded files found for CIK: ${cik}`);
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

				console.log(`\nProcessing: ${formDir} - ${dateDir}`);

				const extractedData = this.extractFromDirectory(datePath);
				if (extractedData) {
					// Generate report
					console.log(this.generateReport(extractedData));

					// Export data
					const baseFileName = `${cik}_${formDir}_${dateDir}`;
					const jsonPath = path.join(datePath, `${baseFileName}_data.json`);
					const csvPath = path.join(datePath, `${baseFileName}_data.csv`);

					this.exportToJSON(extractedData, jsonPath);
					this.exportToCSV(extractedData, csvPath);

					processedCount++;
				}
			}
		}

		console.log(`\n=== Re-processing Complete ===`);
		console.log(`Total filings processed: ${processedCount}`);
	}
}

// =================== USAGE EXAMPLES ===================

async function downloadAndExtractSpecificFiling() {
	const processor = new ComprehensiveXBRLProcessor();

	// Download and extract a specific filing
	const data = await processor.processSpecificFiling(
		"0001318605", // Tesla CIK
		"000162828025003063" // Specific accession number
	);

	if (data) {
		console.log("\n" + processor.generateReport(data));
	}
}

async function downloadAndExtractMultipleFilings() {
	const processor = new ComprehensiveXBRLProcessor();

	// Download and extract the latest 3 10-K filings for Tesla
	await processor.processCompanyFilings(
		"0001318605", // Tesla CIK
		["10-K"], // Form types
		3, // Max filings
		true // Extract data
	);
}

async function downloadOnlyWithoutExtraction() {
	const processor = new ComprehensiveXBRLProcessor();

	// Just download files without extracting data (faster)
	await processor.processCompanyFilings(
		"0001318605", // Tesla CIK
		["10-Q", "10-K"], // Multiple form types
		5, // Max filings
		false // Don't extract data yet
	);
}

async function reprocessExistingFiles() {
	const processor = new ComprehensiveXBRLProcessor();

	// Re-process already downloaded files to extract data
	await processor.reprocessDownloadedFiles("0001318605");
}

async function downloadAndExtractAllRecent() {
	const processor = new ComprehensiveXBRLProcessor();

	// Download and extract all recent 10-Q and 10-K filings
	await processor.processCompanyFilings(
		"0001318605", // Tesla CIK
		["10-Q", "10-K"], // Form types
		undefined, // No limit - all filings
		true // Extract data
	);
}

// Main execution function
async function main() {
	console.log("🚀 Comprehensive XBRL Processor Starting...\n");

	try {
		// Choose which operation to run:

		// Option 1: Download and extract a specific filing
		// await downloadAndExtractSpecificFiling();

		// Option 2: Download and extract multiple filings with limits
		await downloadAndExtractMultipleFilings();

		// Option 3: Just download files (no extraction)
		// await downloadOnlyWithoutExtraction();

		// Option 4: Re-process already downloaded files
		// await reprocessExistingFiles();

		// Option 5: Download and extract all recent filings (be careful - lots of data!)
		// await downloadAndExtractAllRecent();

		console.log("\n✅ Processing completed successfully!");
	} catch (error) {
		console.error("\n❌ Processing failed:", error);
		process.exit(1);
	}
}

// Additional utility functions for specific use cases

/**
 * Quick financial summary for a company's latest filing
 */
async function getLatestFinancialSummary(
	cik: string,
	formType: string = "10-K"
) {
	const processor = new ComprehensiveXBRLProcessor();

	console.log(
		`\n📊 Getting latest ${formType} financial summary for CIK: ${cik}`
	);

	try {
		// Get just the latest filing
		const filings = await processor.getAllFilings(cik, [formType]);

		if (filings.length === 0) {
			console.log(`No ${formType} filings found`);
			return;
		}

		const latestFiling = filings[0];
		console.log(
			`Latest ${formType}: ${latestFiling.filingDate} (${latestFiling.accessionNumber})`
		);

		// Process the filing
		const data = await processor.processSpecificFiling(
			cik,
			latestFiling.accessionNumber
		);

		if (data) {
			// Generate and show report
			console.log("\n" + processor.generateReport(data));

			// Save summary file
			const summaryPath = `./financial_summary_${cik}_${formType}_${latestFiling.filingDate}.json`;
			processor.exportToJSON(data, summaryPath);
		}
	} catch (error) {
		console.error("Failed to get financial summary:", error);
	}
}

/**
 * Compare financial metrics across multiple periods
 */
async function compareFinancialMetrics(
	cik: string,
	formType: string = "10-K",
	periods: number = 3
) {
	const processor = new ComprehensiveXBRLProcessor();

	console.log(
		`\n📈 Comparing financial metrics across ${periods} ${formType} filings for CIK: ${cik}`
	);

	try {
		const filings = await processor.getAllFilings(cik, [formType]);
		const filingsToProcess = filings.slice(0, periods);

		console.log(
			`Processing ${filingsToProcess.length} filings for comparison...`
		);

		const comparisonData: ExtractedData[] = [];

		for (const filing of filingsToProcess) {
			console.log(`\nProcessing ${filing.form} from ${filing.filingDate}...`);

			const data = await processor.processSpecificFiling(
				cik,
				filing.accessionNumber
			);
			if (data) {
				comparisonData.push(data);
			}
		}

		if (comparisonData.length > 0) {
			console.log("\n" + "=".repeat(80));
			console.log("FINANCIAL METRICS COMPARISON");
			console.log("=".repeat(80));

			// Key metrics to compare
			const keyMetrics = [
				"Assets",
				"TotalAssets",
				"CurrentAssets",
				"Liabilities",
				"CurrentLiabilities",
				"StockholdersEquity",
				"RetainedEarnings",
				"Revenue",
				"Revenues",
				"NetIncome",
			];

			for (const metric of keyMetrics) {
				console.log(`\n${metric.toUpperCase()}:`);
				console.log("-".repeat(40));

				comparisonData.forEach((data, index) => {
					const matchingFacts = data.facts.filter((f) =>
						f.concept.toLowerCase().includes(metric.toLowerCase())
					);

					if (matchingFacts.length > 0) {
						const fact = matchingFacts[0];
						const formattedValue =
							typeof fact.value === "number"
								? fact.value.toLocaleString()
								: fact.value;
						console.log(`  ${data.filingDate}: ${formattedValue}`);
					}
				});
			}

			// Export comparison data
			const comparisonPath = `./financial_comparison_${cik}_${formType}.json`;
			fs.writeFileSync(
				comparisonPath,
				JSON.stringify(comparisonData, null, 2),
				"utf-8"
			);
			console.log(`\nComparison data exported to: ${comparisonPath}`);
		}
	} catch (error) {
		console.error("Failed to compare financial metrics:", error);
	}
}

/**
 * Batch process multiple companies
 */
async function batchProcessCompanies(
	companies: { cik: string; name: string }[]
) {
	const processor = new ComprehensiveXBRLProcessor();

	console.log(`\n🏭 Batch processing ${companies.length} companies...`);

	for (let i = 0; i < companies.length; i++) {
		const company = companies[i];
		console.log(
			`\n[${i + 1}/${companies.length}] Processing ${company.name} (CIK: ${
				company.cik
			})`
		);

		try {
			await processor.processCompanyFilings(
				company.cik,
				["10-K", "10-Q"], // Get both annual and quarterly
				5, // Limit to 5 most recent
				true // Extract data
			);
		} catch (error) {
			console.error(`Failed to process ${company.name}:`, error);
			continue; // Continue with next company
		}
	}

	console.log("\n✅ Batch processing completed!");
}

// Run the main function
// Uncomment the function you want to test:

// For basic processing:
main().catch(console.error);

// For financial summary:
// getLatestFinancialSummary("0001318605").catch(console.error); // Tesla

// For comparison:
// compareFinancialMetrics("0001318605", "10-K", 3).catch(console.error); // Tesla last 3 10-Ks

// For batch processing multiple companies:
// const companies = [
//   { cik: "0001318605", name: "Tesla" },
//   { cik: "0000320193", name: "Apple" },
//   { cik: "0001652044", name: "Alphabet" }
// ];
// batchProcessCompanies(companies).catch(console.error);

/*
USAGE INSTRUCTIONS:

1. Basic Usage:
   - Run `main()` to download and extract recent filings
   - Modify the main function to choose which operation to run

2. Specific Filing:
   - Use `downloadAndExtractSpecificFiling()` for a single filing
   - Need the exact accession number

3. Multiple Filings:
   - Use `downloadAndExtractMultipleFilings()` for recent filings
   - Can filter by form type and limit count

4. Re-process Existing:
   - Use `reprocessExistingFiles()` if you already downloaded files
   - Just re-extracts the data without re-downloading

5. Financial Summary:
   - Use `getLatestFinancialSummary()` for a quick overview
   - Gets the most recent filing of specified type

6. Comparison:
   - Use `compareFinancialMetrics()` to compare across periods
   - Shows trends in key metrics

7. Batch Processing:
   - Use `batchProcessCompanies()` for multiple companies
   - Process several companies at once

Output Files:
- Raw XBRL files: ./downloads/CIK_[number]/[form-type]/[date]/
- Extracted data: [company]_[form]_[date]_data.json
- CSV data: [company]_[form]_[date]_data.csv
- Summary reports: financial_summary_[cik]_[form]_[date].json

The processor will:
1. ✅ Download all required XBRL files (_pre.xml, _lab.xml, instance files)
2. ✅ Parse presentation structure from _pre.xml
3. ✅ Parse human-readable labels from _lab.xml  
4. ✅ Extract actual financial values from instance files
5. ✅ Match contexts to understand time periods
6. ✅ Generate comprehensive reports
7. ✅ Export data in JSON and CSV formats

Rate limiting is built-in to be respectful to SEC servers.
*/
