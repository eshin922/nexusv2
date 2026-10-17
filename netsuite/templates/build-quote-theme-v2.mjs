import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let xml = readFileSync(join(here, "dps-purchase-order.sandbox-candidate.xml"), "utf8").replace(/\r\n/g, "\n");

function replaceRegion(startText, endText, replacement, searchFrom = 0) {
  const start = xml.indexOf(startText, searchFrom);
  if (start < 0) throw new Error(`Missing start: ${startText}`);
  const end = xml.indexOf(endText, start + startText.length);
  if (end < 0) throw new Error(`Missing end: ${endText}`);
  const removed = xml.slice(start, end);
  xml = xml.slice(0, start) + replacement + xml.slice(end);
  return removed;
}

replaceRegion('            <macro id="nlheader">', '            <macro id="nlfooter">', `            <macro id="nlheader">
                <table class="nx-masthead" style="width:100%; border-bottom:1.1pt solid #131921;">
                    <tr>
                        <td width="56%" valign="top">
                            <#if subsidiary.logo?length !=0>
                                <img src="${'${subsidiary.logo@url}'}" style="width:50pt; height:50pt;" />
                            </#if>
                        </td>
                        <td width="44%" align="right" valign="top">
                            <p style="margin:0 0 5pt 0; line-height:18pt; font-family:NotoSans,sans-serif; font-size:14pt; font-weight:bold; color:#131921;">PURCHASE ORDER</p>
                            <p class="nx-po-number" style="margin:0 0 6pt 0; line-height:15pt;">${'${record.tranid}'}</p>
                            <p class="nx-meta" style="margin:0 0 3pt 0; line-height:11pt;">ISSUED · ${'${record.trandate}'}</p>
                            <p class="nx-meta" style="margin:0; line-height:11pt;">REQUIRED BY · ${'${record.shipdate}'}</p>
                        </td>
                    </tr>
                </table>
            </macro>
`);

replaceRegion('            <macro id="nlfooter">', '        </macrolist>', `            <macro id="nlfooter">
                <table class="nx-footer" style="width:100%; border-top:0.75pt solid #d3d1ca;">
                    <tr>
                        <td align="left" width="75%">THE DPS · PURCHASE ORDER ${'${record.tranid}'}</td>
                        <td align="right" width="25%">PAGE <pagenumber /> OF <totalpages /></td>
                    </tr>
                </table>
            </macro>
`);

const themeCss = `
            body { color:#131921; background-color:#fefdfc; font-family:NotoSans,sans-serif; }
            .nx-masthead td { padding:0 0 11pt 0; border:none; }
            .nx-brand { font-family:Times,serif; font-size:20.25pt; color:#131921; }
            .nx-subbrand { font-family:Times,serif; font-size:9pt; color:#646971; }
            .nx-po-number { font-family:Courier,monospace; font-size:12pt; color:#131921; }
            .nx-meta { font-family:Courier,monospace; font-size:7.5pt; color:#646971; line-height:1.8; }
            .nx-parties { width:100%; margin-top:14pt; }
            .nx-parties td { width:50%; vertical-align:top; padding:0 16pt 0 0; border:none; }
            .nx-parties p { margin:0 0 3pt 0; line-height:11pt; }
            .nx-label { font-family:Courier,monospace; font-size:6.75pt; color:#7b8187; letter-spacing:0.7pt; }
            .nx-party-name { font-family:Times,serif; font-size:12pt; color:#131921; }
            .nx-party-line { font-family:Times,serif; font-size:9pt; color:#383e46; line-height:1.45; }
            .nx-facts { width:100%; margin-top:13pt; border-top:0.75pt solid #d3d1ca; border-bottom:0.75pt solid #d3d1ca; }
            .nx-facts td { padding:7pt 8pt 7pt 0; vertical-align:top; border:none; }
            .nx-fact-value { font-family:Times,serif; font-size:8.5pt; color:#383e46; }
            .nx-items { width:100%; margin-top:17pt; table-layout:fixed; }
            .nx-items th { font-family:Courier,monospace; font-size:7pt; font-weight:normal; color:#646971; background-color:#fefdfc; border-bottom:1.1pt solid #131921; padding:0 5pt 6pt 0; }
            .nx-items td { padding:9pt 5pt 8pt 0; border-bottom:0.75pt solid #d3d1ca; vertical-align:top; }
            .nx-item-name { font-family:Times,serif; font-size:10.5pt; color:#131921; }
            .nx-item-sku { font-family:Courier,monospace; font-size:6.75pt; color:#7b8187; }
            .nx-item-desc { font-family:Times,serif; font-size:8pt; color:#646971; }
            .nx-num { font-family:Courier,monospace; font-size:9pt; color:#131921; }
            .nx-spec td { padding:2pt 6pt 8pt 8pt; border-bottom:0.75pt solid #d3d1ca; color:#646971; font-size:7.5pt; }
            .nx-spec-body { border-left:0.75pt solid #d3d1ca; padding-left:7pt; }
            .nx-total td { padding-top:9pt; border-top:1.1pt solid #131921; border-bottom:none; }
            .nx-total-label { font-family:Times,serif; font-size:12pt; color:#131921; }
            .nx-total-value { font-family:Courier,monospace; font-size:11pt; color:#131921; }
            .nx-legal-title { font-family:Times,serif; font-size:13.5pt; color:#131921; }
            .nx-footer td { padding-top:8pt; font-family:Courier,monospace; font-size:6.5pt; color:#7b8187; }
`;
xml = xml.replace('        </style>', `${themeCss}        </style>`);

const oldBodyStart = xml.indexOf('    <body header="nlheader"');
const oldHr = xml.indexOf('        <hr />', oldBodyStart);
if (oldBodyStart < 0 || oldHr < 0) throw new Error("Body intro missing");
xml = xml.slice(0, oldBodyStart) + `    <body header="nlheader" header-height="12%" footer="nlfooter" footer-height="30pt" padding="42pt 48pt 48pt 48pt" size="Letter">
        <table class="nx-parties">
            <tr>
                <td>
                    <p class="nx-label">PREPARED FOR</p>
                    <p class="nx-party-name">${'${record.entity}'}</p>
                    <p class="nx-party-line">${'${record.billattention}'}</p>
                    <p class="nx-party-line">${'${record.billingaddress_text}'}</p>
                </td>
                <td>
                    <p class="nx-label">PREPARED BY</p>
                    <p class="nx-party-name">The DPS</p>
                    <p class="nx-party-line">${'${subsidiary.mainaddress_text}'}</p>
                    <p class="nx-party-line">${'${companyInformation.email}'}</p>
                </td>
            </tr>
        </table>
        <table class="nx-facts">
            <tr>
                <td width="50%"><span class="nx-label">SHIP TO</span><br /><span class="nx-fact-value">${'${record.custbody_dps_shipping_address}'}</span></td>
                <td width="25%"><span class="nx-label">SHIP DATE</span><br /><span class="nx-fact-value">${'${record.shipdate}'}</span></td>
                <td width="25%"><span class="nx-label">PAYMENT TERMS</span><br /><span class="nx-fact-value">${'${record.terms}'}</span></td>
            </tr>
        </table>
` + xml.slice(oldHr);

const legacyStart = xml.indexOf('        <hr />\n        <table class="detail"', oldBodyStart);
const itemsStart = xml.indexOf('        <#if record.item?has_content>', legacyStart);
if (legacyStart < 0 || itemsStart < 0) throw new Error("Legacy section missing");
xml = xml.slice(0, legacyStart) + xml.slice(itemsStart);

const tableStart = xml.indexOf('<table class="detail"', xml.indexOf('<#assign items='));
const tableEnd = xml.indexOf('</table>', tableStart) + '</table>'.length;
if (tableStart < 0 || tableEnd < 0) throw new Error("Item table missing");
xml = xml.slice(0, tableStart) + `<table class="nx-items">
    <thead><tr>
        <th width="53%" align="left">ITEM</th>
        <th width="15%" align="right">QUANTITY</th>
        <th width="16%" align="right">RATE</th>
        <th width="16%" align="right">AMOUNT</th>
    </tr></thead>
    <#list items as item>
        <tr>
            <td width="53%"><span class="nx-item-name">${'${item.custcol_dps_item_display_name}'}</span><br />
                <span class="nx-item-sku">${'${item.custcol_dps_sku}'}</span>
                <#if item.description?has_content><br /><span class="nx-item-desc">${'${item.description}'}</span></#if></td>
            <td width="15%" align="right"><span class="nx-num">${'${item.quantity}'} ${'${item.units}'}</span></td>
            <td width="16%" align="right"><span class="nx-num"><#if hasRawIngredientsClass>$${'${(item.rate*1000)?string.number}'}<#else>$${'${(item.rate)?string.number}'}</#if></span></td>
            <td width="16%" align="right"><span class="nx-num">${'${item.amount}'}</span></td>
        </tr>
        <#if item.custcol_nx_spec_text?has_content>
            <tr class="nx-spec"><td colspan="4"><div class="nx-spec-body">
                <span class="nx-label">ORDERED SPECIFICATION</span>
                <#list item.custcol_nx_spec_text?replace("<br />", "\\n")?replace("<br/>", "\\n")?replace("<br>", "\\n")?replace("\\r", "")?split("\\n") as specLine><#if specLine?has_content><br />${'${specLine?html}'}</#if></#list>
            </div></td></tr>
        </#if>
    </#list>
    <#if record.subtotal?has_content><tr><td colspan="3" align="right">Subtotal</td><td align="right" class="nx-num">${'${record.subtotal}'}</td></tr></#if>
    <#if record.taxtotal?has_content><tr><td colspan="3" align="right">Tax</td><td align="right" class="nx-num">${'${record.taxtotal}'}</td></tr></#if>
    <tr class="nx-total"><td colspan="3"><span class="nx-total-label">Total</span></td><td align="right"><span class="nx-total-value">${'${record.total}'}</span></td></tr>
</table>` + xml.slice(tableEnd);

const legalStart = xml.indexOf('        <div style="text-align: center;">');
if (legalStart < 0) throw new Error("Legal section missing");
xml = xml.replace('<strong>Purchase Terms and Conditions</strong>', '<span class="nx-legal-title">Purchase Terms and Conditions</span>');

writeFileSync(join(here, "dps-purchase-order.quote-theme-v2.xml"), xml);
