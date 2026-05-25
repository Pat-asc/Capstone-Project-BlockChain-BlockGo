const encoder = new TextEncoder();

const escapeXml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const columnNumberToName = (columnNumber) => {
  let name = "";
  let current = columnNumber;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
};

const buildCellReference = (rowIndex, columnIndex) =>
  `${columnNumberToName(columnIndex)}${rowIndex}`;

const buildCellXml = (cell, rowIndex, columnIndex) => {
  const reference = buildCellReference(rowIndex, columnIndex);

  if (cell && typeof cell === "object" && cell.type === "formula") {
    const formula = String(cell.formula || "").replace(/^=/, "");
    const value =
      cell.value === undefined || cell.value === null || cell.value === ""
        ? ""
        : `<v>${escapeXml(cell.value)}</v>`;

    return `<c r="${reference}"><f>${escapeXml(formula)}</f>${value}</c>`;
  }

  if (cell && typeof cell === "object" && cell.type === "number") {
    return `<c r="${reference}"><v>${escapeXml(cell.value ?? "")}</v></c>`;
  }

  const textValue =
    cell && typeof cell === "object" && Object.prototype.hasOwnProperty.call(cell, "value")
      ? cell.value
      : cell;

  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(
    textValue ?? ""
  )}</t></is></c>`;
};

const buildSheetXml = (rows = []) => {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cellXml = row
        .map((cell, columnIndex) => buildCellXml(cell, rowIndex + 1, columnIndex + 1))
        .join("");

      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
};

const buildWorkbookXml = (sheetName) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
  <calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`;

const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font>
      <sz val="11"/>
      <name val="Calibri"/>
    </font>
  </fonts>
  <fills count="1">
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }

  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const numberToBytes = (value, byteLength) => {
  const bytes = new Uint8Array(byteLength);

  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = (value >>> (index * 8)) & 0xff;
  }

  return bytes;
};

const concatBytes = (...chunks) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
};

const createStoredZip = (entries) => {
  const localFiles = [];
  const centralDirectory = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const contentBytes =
      entry.content instanceof Uint8Array ? entry.content : encoder.encode(entry.content);
    const crc = crc32(contentBytes);

    const localHeader = concatBytes(
      numberToBytes(0x04034b50, 4),
      numberToBytes(20, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(crc, 4),
      numberToBytes(contentBytes.length, 4),
      numberToBytes(contentBytes.length, 4),
      numberToBytes(nameBytes.length, 2),
      numberToBytes(0, 2),
      nameBytes,
      contentBytes
    );

    localFiles.push(localHeader);

    const centralHeader = concatBytes(
      numberToBytes(0x02014b50, 4),
      numberToBytes(20, 2),
      numberToBytes(20, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(crc, 4),
      numberToBytes(contentBytes.length, 4),
      numberToBytes(contentBytes.length, 4),
      numberToBytes(nameBytes.length, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 2),
      numberToBytes(0, 4),
      numberToBytes(offset, 4),
      nameBytes
    );

    centralDirectory.push(centralHeader);
    offset += localHeader.length;
  });

  const centralDirectoryBytes = concatBytes(...centralDirectory);
  const localFilesBytes = concatBytes(...localFiles);
  const endOfCentralDirectory = concatBytes(
    numberToBytes(0x06054b50, 4),
    numberToBytes(0, 2),
    numberToBytes(0, 2),
    numberToBytes(entries.length, 2),
    numberToBytes(entries.length, 2),
    numberToBytes(centralDirectoryBytes.length, 4),
    numberToBytes(localFilesBytes.length, 4),
    numberToBytes(0, 2)
  );

  return concatBytes(localFilesBytes, centralDirectoryBytes, endOfCentralDirectory);
};

export const downloadSimpleXlsx = ({
  fileName = "workbook.xlsx",
  sheetName = "Sheet1",
  rows = [],
}) => {
  const entries = [
    {
      name: "[Content_Types].xml",
      content: contentTypesXml,
    },
    {
      name: "_rels/.rels",
      content: rootRelsXml,
    },
    {
      name: "xl/workbook.xml",
      content: buildWorkbookXml(sheetName),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: workbookRelsXml,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: buildSheetXml(rows),
    },
    {
      name: "xl/styles.xml",
      content: stylesXml,
    },
  ];

  const zipBytes = createStoredZip(entries);
  const blob = new Blob([zipBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
