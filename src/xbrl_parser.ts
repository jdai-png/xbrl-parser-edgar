import { DOMParser } from "xmldom";
import { type XBRLTag, type XBRLFact, type XBRLContext } from "./types";

/**
 * Parses various XBRL file types to extract structured data.
 */
export class XbrlParser {
  /**
   * Parses the presentation file to build a structure of XBRL tags.
   */
  public parsePreFile(preXmlContent: string): { [tag: string]: XBRLTag } {
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
  public parseLabFile(
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
  public parseInstanceFile(instanceXmlContent: string): {
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
}
