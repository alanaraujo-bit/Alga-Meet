import { a as $$Base, c as createComponent, i as $$Logo, l as __exportAll, n as downloadUrl, o as renderScript, r as releasesUrl, s as createAstro, t as downloadNote } from "./links_BveOkCAn.mjs";
import { i as getAssetsPrefix, t as createConsoleLogger } from "./console_wNEiZfXK.mjs";
import { d as joinPaths, f as prependForwardSlash, h as removeQueryString, p as removeBase, s as fileExtension, t as isRemoteAllowed, u as isRemotePath } from "./remote_I2AsRZT5.mjs";
import { B as RemoteImageNotAllowed, D as MissingImageDimension, K as UnsupportedImageConversion, S as LocalImageUsedWrongly, Y as AstroError, _ as IncompatibleDescriptorOptions, c as ExpectedImageOptions, g as ImageMissingAlt, j as NoImageMetadata, l as ExpectedNotESMImage, q as UnsupportedImageFormat, s as ExpectedImage, u as FailedToFetchRemoteImageDimensions, x as InvalidImageService } from "./errors-data_HNc_BBfZ.mjs";
import { g as addAttribute, m as maybeRenderHead, p as renderTemplate, s as renderComponent, t as spreadAttributes, x as shorthash } from "./server_BBQtozpp.mjs";
import * as mime from "mrmime";
// ../Alga Meet/node_modules/astro/dist/core/render-scope/scope.js
/**
* The channel is a write-once immutable *conduit* shared so every compiled copy
* of this module resolves the same AsyncLocalStorage instance (the prerender
* runtime is bundled, so the build orchestrator and the bundled runtime hold
* different module instances of this file); all mutable per-render state lives
* in stores reachable only through async execution context. Never installed in
* dev or production SSR runtimes. It holds no state, so it stays installed across builds.
*/
var SCOPE_KEY = Symbol.for("astro:render-scope");
/** The installed render scope, or `undefined` when none was installed. */
function getInstalledRenderScope() {
	return globalThis[SCOPE_KEY];
}
/** The current render's collectors store, or `undefined` when not collecting. */
function getRenderCollectors() {
	return getInstalledRenderScope()?.getStore();
}
// ../Alga Meet/node_modules/astro/dist/core/render-scope/record.js
function isCollectingStaticImages() {
	return getRenderCollectors()?.staticImages !== void 0;
}
/** Keeps repeats; `collectPrerenderMetadata()` dedupes them. */
function recordStaticImage(image) {
	getRenderCollectors()?.staticImages?.push(image);
}
/** Records an untransformed image reference against the active render. */
function recordReferencedImage(fsPath) {
	getRenderCollectors()?.referencedImages?.add(fsPath);
}
// apps/site/src/components/Download.astro
createAstro("http://localhost:4599");
var $$Download = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Download;
	const { size = "lg", label = "Baixar para Windows", class: cls } = Astro.props;
	const classes = [
		"btn",
		"btn-primary",
		size === "lg" && "btn-lg",
		cls
	];
	return renderTemplate`${renderTemplate`${maybeRenderHead($$result)}<a${addAttribute(classes, "class:list")}${addAttribute(downloadUrl, "href")} data-download><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5 10 4.5v7H3zM11 4.4 21 3v8.5H11zM3 12.5h7v7l-7-1zM11 12.5h10V21l-10-1.4z"></path></svg>${label}</a>`}`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Download.astro", void 0);
// apps/site/src/components/Nav.astro
var $$Nav = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<header class="nav" data-nav data-astro-cid-wpvy4v7s><div class="bar" data-astro-cid-wpvy4v7s><a href="#topo" class="home" aria-label="Alga Meet, voltar ao topo" data-astro-cid-wpvy4v7s>${renderComponent($$result, "Logo", $$Logo, { "data-astro-cid-wpvy4v7s": true })}</a><nav aria-label="Seções" data-astro-cid-wpvy4v7s><ul data-astro-cid-wpvy4v7s>${[
		["#voz", "Voz"],
		["#tela", "Tela"],
		["#leve", "Leveza"],
		["#grupo", "Grupo"],
		["#privacidade", "Privacidade"],
		["#plus", "Plus"]
	].map(([href, label]) => renderTemplate`<li data-astro-cid-wpvy4v7s><a${addAttribute(href, "href")} data-astro-cid-wpvy4v7s>${label}</a></li>`)}</ul></nav>${renderComponent($$result, "Download", $$Download, {
		"size": "md",
		"label": "Baixar",
		"class": "nav-cta",
		"data-astro-cid-wpvy4v7s": true
	})}</div></header>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Nav.astro", void 0);
// \0virtual:astro:logger
var level = "info";
// ../Alga Meet/node_modules/astro/dist/assets/consts.js
/**
* Valid formats that our base services support.
* Certain formats can be imported (namely SVGs) but will not be processed.
*/
var VALID_SUPPORTED_FORMATS = [
	"jpeg",
	"jpg",
	"png",
	"tiff",
	"webp",
	"gif",
	"svg",
	"avif"
];
var DEFAULT_OUTPUT_FORMAT = "webp";
var DEFAULT_HASH_PROPS = [
	"src",
	"width",
	"height",
	"format",
	"quality",
	"fit",
	"position",
	"background"
];
// ../Alga Meet/node_modules/astro/dist/assets/layout.js
var DEFAULT_RESOLUTIONS = [
	640,
	750,
	828,
	960,
	1080,
	1280,
	1668,
	1920,
	2048,
	2560,
	3200,
	3840,
	4480,
	5120,
	6016
];
var LIMITED_RESOLUTIONS = [
	640,
	750,
	828,
	1080,
	1280,
	1668,
	2048,
	2560
];
/**
* Gets the breakpoints for an image, based on the layout and width
*
* The rules are as follows:
*
* - For full-width layout we return all breakpoints smaller than the original image width
* - For fixed layout we return 1x and 2x the requested width, unless the original image is smaller than that.
* - For responsive layout we return all breakpoints smaller than 2x the requested width, unless the original image is smaller than that.
*/
var getWidths = ({ width, layout, breakpoints = DEFAULT_RESOLUTIONS, originalWidth }) => {
	const smallerThanOriginal = (w) => !originalWidth || w <= originalWidth;
	if (layout === "full-width") return breakpoints.filter(smallerThanOriginal);
	if (!width) return [];
	const doubleWidth = width * 2;
	const maxSize = originalWidth ? Math.min(doubleWidth, originalWidth) : doubleWidth;
	if (layout === "fixed") return originalWidth && width > originalWidth ? [originalWidth] : [width, maxSize];
	if (layout === "constrained") return [
		width,
		doubleWidth,
		...breakpoints
	].filter((w) => w <= maxSize).sort((a, b) => a - b);
	return [];
};
/**
* Gets the `sizes` attribute for an image, based on the layout and width
*/
var getSizesAttribute = ({ width, layout }) => {
	if (!width || !layout) return;
	switch (layout) {
		case "constrained": return `(min-width: ${width}px) ${width}px, 100vw`;
		case "fixed": return `${width}px`;
		case "full-width": return `100vw`;
		default: return;
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/imageKind.js
/**
* Determines if the given source is an ECMAScript Module (ESM) imported image.
*
* @param {ImageMetadata | string} src - The source to check. It can be an `ImageMetadata` object or a string.
* @return {boolean} Returns `true` if the source is an `ImageMetadata` object; otherwise, `false`.
*/
function isESMImportedImage(src) {
	return typeof src === "object" || typeof src === "function" && "src" in src;
}
/**
* Determines if the provided source is a remote image URL in the form of a string.
*
* @param {ImageMetadata | string} src - The source to check, which can either be an `ImageMetadata` object or a string.
* @return {boolean} Returns `true` if the source is a string; otherwise, `false`.
*/
function isRemoteImage(src) {
	return typeof src === "string";
}
/**
* Resolves the source of an image transformation by handling asynchronous or synchronous inputs.
*
* @param {UnresolvedImageTransform['src']} src - The source of the image transformation.
* @return {Promise<string | ImageMetadata>} A promise that resolves to the image source. It returns either the default export of the resolved source or the resolved source itself if the default export doesn't exist.
*/
async function resolveSrc(src) {
	if (typeof src === "object" && "then" in src) {
		const resource = await src;
		return resource.default ?? resource;
	}
	return src;
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/inferSourceFormat.js
var DATA_PREFIX = "data:";
/**
* Infer the image format from a source path or URL.
*
* For `data:` URIs the MIME is read up to the first `;` or `,` (whichever comes first),
* so both `data:image/svg+xml;base64,...` and `data:image/svg+xml,<svg>...` work.
* `image/svg+xml` normalizes to `svg`; otherwise the subtype after the slash is returned.
*
* Returns undefined when the format cannot be determined.
*/
function inferSourceFormat(src) {
	if (src.startsWith(DATA_PREFIX)) {
		const sepIndex = src.indexOf(";");
		const commaIndex = src.indexOf(",");
		const mimeEnd = sepIndex === -1 ? commaIndex : commaIndex === -1 ? sepIndex : Math.min(sepIndex, commaIndex);
		if (mimeEnd === -1) return void 0;
		const mime = src.slice(5, mimeEnd);
		if (mime === "image/svg+xml") return "svg";
		return mime.split("/")[1] || void 0;
	}
	try {
		const cleanSrc = removeQueryString(src).split("#")[0];
		const lastSlash = cleanSrc.lastIndexOf("/");
		const basename = lastSlash === -1 ? cleanSrc : cleanSrc.slice(lastSlash + 1);
		const lastDot = basename.lastIndexOf(".");
		if (lastDot === -1) return void 0;
		return basename.slice(lastDot + 1).toLowerCase();
	} catch {
		return;
	}
}
function resolveDefaultOutputFormat(sourceFormat) {
	return sourceFormat === "svg" ? "svg" : DEFAULT_OUTPUT_FORMAT;
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/utils.js
var decoder = new TextDecoder();
var toUTF8String = (input, start = 0, end = input.length) => decoder.decode(input.slice(start, end));
var toHexString = (input, start = 0, end = input.length) => input.slice(start, end).reduce((memo, i) => memo + `0${i.toString(16)}`.slice(-2), "");
var getView = (input, offset) => new DataView(input.buffer, input.byteOffset + offset);
var readInt16LE = (input, offset = 0) => getView(input, offset).getInt16(0, true);
var readUInt16BE = (input, offset = 0) => getView(input, offset).getUint16(0, false);
var readUInt16LE = (input, offset = 0) => getView(input, offset).getUint16(0, true);
var readUInt24LE = (input, offset = 0) => {
	const view = getView(input, offset);
	return view.getUint16(0, true) + (view.getUint8(2) << 16);
};
var readInt32LE = (input, offset = 0) => getView(input, offset).getInt32(0, true);
var readUInt32BE = (input, offset = 0) => getView(input, offset).getUint32(0, false);
var readUInt32LE = (input, offset = 0) => getView(input, offset).getUint32(0, true);
var readUInt64 = (input, offset, isBigEndian) => getView(input, offset).getBigUint64(0, !isBigEndian);
var methods = {
	readUInt16BE,
	readUInt16LE,
	readUInt32BE,
	readUInt32LE
};
function readUInt(input, bits, offset = 0, isBigEndian = false) {
	return methods[`readUInt${bits}${isBigEndian ? "BE" : "LE"}`](input, offset);
}
var MIN_BOX_HEADER = 8;
function readBox(input, offset) {
	if (input.length - offset < MIN_BOX_HEADER) return;
	const boxSize = readUInt32BE(input, offset);
	if (boxSize === 0) return {
		name: toUTF8String(input, offset + 4, offset + 8),
		offset,
		size: input.length - offset
	};
	if (boxSize === 1) return;
	if (boxSize < MIN_BOX_HEADER) return;
	if (input.length - offset < boxSize) return;
	return {
		name: toUTF8String(input, offset + 4, offset + 8),
		offset,
		size: boxSize
	};
}
function findBox(input, boxName, startOffset) {
	let offset = startOffset;
	while (offset < input.length) {
		const box = readBox(input, offset);
		if (!box) break;
		if (box.name === boxName) return box;
		if (box.size < MIN_BOX_HEADER) break;
		const nextOffset = offset + box.size;
		if (nextOffset <= offset) break;
		offset = nextOffset;
	}
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/bmp.js
var BMP = {
	validate: (input) => toUTF8String(input, 0, 2) === "BM",
	calculate: (input) => ({
		height: Math.abs(readInt32LE(input, 22)),
		width: readUInt32LE(input, 18)
	})
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/ico.js
var TYPE_ICON = 1;
/**
* ICON Header
*
* | Offset | Size | Purpose |
* | 0	    | 2    | Reserved. Must always be 0.  |
* | 2      | 2    | Image type: 1 for icon (.ICO) image, 2 for cursor (.CUR) image. Other values are invalid. |
* | 4      | 2    | Number of images in the file. |
*
*/
var SIZE_HEADER$1 = 6;
/**
* Image Entry
*
* | Offset | Size | Purpose |
* | 0	    | 1    | Image width in pixels. Can be any number between 0 and 255. Value 0 means width is 256 pixels. |
* | 1      | 1    | Image height in pixels. Can be any number between 0 and 255. Value 0 means height is 256 pixels. |
* | 2      | 1    | Number of colors in the color palette. Should be 0 if the image does not use a color palette. |
* | 3      | 1    | Reserved. Should be 0. |
* | 4      | 2    | ICO format: Color planes. Should be 0 or 1. |
* |        |      | CUR format: The horizontal coordinates of the hotspot in number of pixels from the left. |
* | 6      | 2    | ICO format: Bits per pixel. |
* |        |      | CUR format: The vertical coordinates of the hotspot in number of pixels from the top. |
* | 8      | 4    | The size of the image's data in bytes |
* | 12     | 4    | The offset of BMP or PNG data from the beginning of the ICO/CUR file |
*
*/
var SIZE_IMAGE_ENTRY = 16;
function getSizeFromOffset(input, offset) {
	const value = input[offset];
	return value === 0 ? 256 : value;
}
function getImageSize$1(input, imageIndex) {
	const offset = SIZE_HEADER$1 + imageIndex * SIZE_IMAGE_ENTRY;
	return {
		height: getSizeFromOffset(input, offset + 1),
		width: getSizeFromOffset(input, offset)
	};
}
var ICO = {
	validate(input) {
		const reserved = readUInt16LE(input, 0);
		const imageCount = readUInt16LE(input, 4);
		if (reserved !== 0 || imageCount === 0) return false;
		return readUInt16LE(input, 2) === TYPE_ICON;
	},
	calculate(input) {
		const nbImages = readUInt16LE(input, 4);
		const imageSize = getImageSize$1(input, 0);
		if (nbImages === 1) return imageSize;
		const images = [];
		for (let imageIndex = 0; imageIndex < nbImages; imageIndex += 1) images.push(getImageSize$1(input, imageIndex));
		return {
			width: imageSize.width,
			height: imageSize.height,
			images
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/cur.js
var TYPE_CURSOR = 2;
var CUR = {
	validate(input) {
		const reserved = readUInt16LE(input, 0);
		const imageCount = readUInt16LE(input, 4);
		if (reserved !== 0 || imageCount === 0) return false;
		return readUInt16LE(input, 2) === TYPE_CURSOR;
	},
	calculate: (input) => ICO.calculate(input)
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/dds.js
var DDS = {
	validate: (input) => readUInt32LE(input, 0) === 542327876,
	calculate: (input) => ({
		height: readUInt32LE(input, 12),
		width: readUInt32LE(input, 16)
	})
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/gif.js
var gifRegexp = /^GIF8[79]a/;
var GIF = {
	validate: (input) => gifRegexp.test(toUTF8String(input, 0, 6)),
	calculate: (input) => ({
		height: readUInt16LE(input, 8),
		width: readUInt16LE(input, 6)
	})
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/heif.js
var brandMap = {
	avif: "avif",
	avis: "avif",
	mif1: "heif",
	msf1: "heif",
	heic: "heic",
	heix: "heic",
	hevc: "heic",
	hevx: "heic"
};
function detectType(input, start, end) {
	let hasAvif = false;
	let hasHeic = false;
	let hasHeif = false;
	for (let i = start; i <= end; i += 4) {
		const brand = toUTF8String(input, i, i + 4);
		if (brand === "avif" || brand === "avis") hasAvif = true;
		else if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx") hasHeic = true;
		else if (brand === "mif1" || brand === "msf1") hasHeif = true;
	}
	if (hasAvif) return "avif";
	if (hasHeic) return "heic";
	if (hasHeif) return "heif";
}
var HEIF = {
	validate(input) {
		if (toUTF8String(input, 4, 8) !== "ftyp") return false;
		const ftypBox = findBox(input, "ftyp", 0);
		if (!ftypBox) return false;
		return toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12) in brandMap;
	},
	calculate(input) {
		const metaBox = findBox(input, "meta", 0);
		const iprpBox = metaBox && findBox(input, "iprp", metaBox.offset + 12);
		const ipcoBox = iprpBox && findBox(input, "ipco", iprpBox.offset + 8);
		if (!ipcoBox) throw new TypeError("Invalid HEIF, no ipco box found");
		const type = detectType(input, 8, metaBox.offset);
		const images = [];
		let currentOffset = ipcoBox.offset + 8;
		const ipcoEnd = ipcoBox.offset + ipcoBox.size;
		while (currentOffset < ipcoEnd) {
			const ispeBox = findBox(input, "ispe", currentOffset);
			if (!ispeBox) break;
			if (ispeBox.size < 8) break;
			if (ispeBox.offset + ispeBox.size > ipcoEnd) break;
			const rawWidth = readUInt32BE(input, ispeBox.offset + 12);
			const rawHeight = readUInt32BE(input, ispeBox.offset + 16);
			const clapBox = findBox(input, "clap", currentOffset);
			let width = rawWidth;
			let height = rawHeight;
			if (clapBox && clapBox.offset < ipcoEnd && clapBox.size >= 8) width = rawWidth - readUInt32BE(input, clapBox.offset + 12);
			images.push({
				height,
				width
			});
			const nextOffset = ispeBox.offset + ispeBox.size;
			if (nextOffset <= currentOffset) break;
			currentOffset = nextOffset;
		}
		if (images.length === 0) throw new TypeError("Invalid HEIF, no sizes found");
		return {
			width: images[0].width,
			height: images[0].height,
			type,
			...images.length > 1 ? { images } : {}
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/icns.js
/**
* ICNS Header
*
* | Offset | Size | Purpose                                                |
* | 0	    | 4    | Magic literal, must be "icns" (0x69, 0x63, 0x6e, 0x73) |
* | 4      | 4    | Length of file, in bytes, msb first.                   |
*
*/
var SIZE_HEADER = 8;
var FILE_LENGTH_OFFSET = 4;
var MIN_ENTRY_LENGTH = 8;
/**
* Image Entry
*
* | Offset | Size | Purpose                                                          |
* | 0	    | 4    | Icon type, see OSType below.                                     |
* | 4      | 4    | Length of data, in bytes (including type and length), msb first. |
* | 8      | n    | Icon data                                                        |
*/
var ENTRY_LENGTH_OFFSET = 4;
var ICON_TYPE_SIZE = {
	ICON: 32,
	"ICN#": 32,
	"icm#": 16,
	icm4: 16,
	icm8: 16,
	"ics#": 16,
	ics4: 16,
	ics8: 16,
	is32: 16,
	s8mk: 16,
	icp4: 16,
	icl4: 32,
	icl8: 32,
	il32: 32,
	l8mk: 32,
	icp5: 32,
	ic11: 32,
	ich4: 48,
	ich8: 48,
	ih32: 48,
	h8mk: 48,
	icp6: 64,
	ic12: 32,
	it32: 128,
	t8mk: 128,
	ic07: 128,
	ic08: 256,
	ic13: 256,
	ic09: 512,
	ic14: 512,
	ic10: 1024
};
function readImageHeader(input, imageOffset) {
	const imageLengthOffset = imageOffset + ENTRY_LENGTH_OFFSET;
	return [toUTF8String(input, imageOffset, imageLengthOffset), readUInt32BE(input, imageLengthOffset)];
}
function getImageSize(type) {
	const size = ICON_TYPE_SIZE[type];
	return {
		width: size,
		height: size,
		type
	};
}
var ICNS = {
	validate: (input) => toUTF8String(input, 0, 4) === "icns",
	calculate(input) {
		const inputLength = input.length;
		const fileLength = readUInt32BE(input, FILE_LENGTH_OFFSET);
		let imageOffset = SIZE_HEADER;
		const images = [];
		while (imageOffset < fileLength && imageOffset < inputLength) {
			if (inputLength - imageOffset < MIN_ENTRY_LENGTH) break;
			const imageHeader = readImageHeader(input, imageOffset);
			const entryLength = imageHeader[1];
			if (entryLength < MIN_ENTRY_LENGTH) break;
			const imageSize = getImageSize(imageHeader[0]);
			if (imageSize.width && imageSize.height) images.push(imageSize);
			const nextOffset = imageOffset + entryLength;
			if (nextOffset <= imageOffset) break;
			imageOffset = nextOffset;
		}
		if (images.length === 0) throw new TypeError("Invalid ICNS, no sizes found");
		return {
			width: images[0].width,
			height: images[0].height,
			...images.length > 1 ? { images } : {}
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/j2c.js
var J2C = {
	validate: (input) => readUInt32BE(input, 0) === 4283432785,
	calculate: (input) => ({
		height: readUInt32BE(input, 12),
		width: readUInt32BE(input, 8)
	})
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/jp2.js
var JP2 = {
	validate(input) {
		if (toUTF8String(input, 4, 8) !== "jP  ") return false;
		const ftypBox = findBox(input, "ftyp", 0);
		if (!ftypBox) return false;
		return toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12) === "jp2 ";
	},
	calculate(input) {
		const jp2hBox = findBox(input, "jp2h", 0);
		const ihdrBox = jp2hBox && jp2hBox.size >= 8 && findBox(input, "ihdr", jp2hBox.offset + 8);
		if (ihdrBox && ihdrBox.size >= 8) return {
			height: readUInt32BE(input, ihdrBox.offset + 8),
			width: readUInt32BE(input, ihdrBox.offset + 12)
		};
		throw new TypeError("Unsupported JPEG 2000 format");
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/jpg.js
var EXIF_MARKER = "45786966";
var APP1_DATA_SIZE_BYTES = 2;
var EXIF_HEADER_BYTES = 6;
var BIG_ENDIAN_BYTE_ALIGN = "4d4d";
var LITTLE_ENDIAN_BYTE_ALIGN = "4949";
var IDF_ENTRY_BYTES = 12;
function isEXIF(input) {
	return toHexString(input, 2, 6) === EXIF_MARKER;
}
function extractSize(input, index) {
	return {
		height: readUInt16BE(input, index),
		width: readUInt16BE(input, index + 2)
	};
}
function extractOrientation(exifBlock, isBigEndian) {
	const idfDirectoryEntries = readUInt(exifBlock, 16, 14, isBigEndian);
	for (let directoryEntryNumber = 0; directoryEntryNumber < idfDirectoryEntries; directoryEntryNumber++) {
		const start = 16 + directoryEntryNumber * IDF_ENTRY_BYTES;
		const end = start + IDF_ENTRY_BYTES;
		if (start > exifBlock.length) return;
		const block = exifBlock.slice(start, end);
		if (readUInt(block, 16, 0, isBigEndian) === 274) {
			if (readUInt(block, 16, 2, isBigEndian) !== 3) return;
			if (readUInt(block, 32, 4, isBigEndian) !== 1) return;
			return readUInt(block, 16, 8, isBigEndian);
		}
	}
}
function validateExifBlock(input, index) {
	const exifBlock = input.slice(APP1_DATA_SIZE_BYTES, index);
	const byteAlign = toHexString(exifBlock, EXIF_HEADER_BYTES, 8);
	const isBigEndian = byteAlign === BIG_ENDIAN_BYTE_ALIGN;
	if (isBigEndian || byteAlign === LITTLE_ENDIAN_BYTE_ALIGN) return extractOrientation(exifBlock, isBigEndian);
}
function validateInput(input, index) {
	if (index > input.length) throw new TypeError("Corrupt JPG, exceeded buffer limits");
}
var JPG = {
	validate: (input) => toHexString(input, 0, 2) === "ffd8",
	calculate(_input) {
		let input = _input.slice(4);
		let orientation;
		let next;
		while (input.length) {
			const i = readUInt16BE(input, 0);
			validateInput(input, i);
			if (input[i] !== 255) {
				input = input.slice(1);
				continue;
			}
			if (isEXIF(input)) orientation = validateExifBlock(input, i);
			next = input[i + 1];
			if (next === 192 || next === 193 || next === 194) {
				const size = extractSize(input, i + 5);
				if (!orientation) return size;
				return {
					height: size.height,
					orientation,
					width: size.width
				};
			}
			input = input.slice(i + 2);
		}
		throw new TypeError("Invalid JPG, no size found");
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/utils/bit-reader.js
/** This class helps read Uint8Array bit-by-bit */
var BitReader = class {
	byteOffset = 2;
	bitOffset = 0;
	input;
	endianness;
	constructor(input, endianness) {
		this.input = input;
		this.endianness = endianness;
	}
	/** Reads a specified number of bits, and move the offset */
	getBits(length = 1) {
		let result = 0;
		let bitsRead = 0;
		while (bitsRead < length) {
			if (this.byteOffset >= this.input.length) throw new Error("Reached end of input");
			const currentByte = this.input[this.byteOffset];
			const bitsLeft = 8 - this.bitOffset;
			const bitsToRead = Math.min(length - bitsRead, bitsLeft);
			if (this.endianness === "little-endian") {
				const mask = (1 << bitsToRead) - 1;
				const bits = currentByte >> this.bitOffset & mask;
				result |= bits << bitsRead;
			} else {
				const bits = (currentByte & (1 << bitsToRead) - 1 << 8 - this.bitOffset - bitsToRead) >> 8 - this.bitOffset - bitsToRead;
				result = result << bitsToRead | bits;
			}
			bitsRead += bitsToRead;
			this.bitOffset += bitsToRead;
			if (this.bitOffset === 8) {
				this.byteOffset++;
				this.bitOffset = 0;
			}
		}
		return result;
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/jxl-stream.js
function calculateImageDimension(reader, isSmallImage) {
	if (isSmallImage) return 8 * (1 + reader.getBits(5));
	const extraBits = [
		9,
		13,
		18,
		30
	][reader.getBits(2)];
	return 1 + reader.getBits(extraBits);
}
function calculateImageWidth(reader, isSmallImage, widthMode, height) {
	if (isSmallImage && widthMode === 0) return 8 * (1 + reader.getBits(5));
	if (widthMode === 0) return calculateImageDimension(reader, false);
	return Math.floor(height * [
		1,
		1.2,
		4 / 3,
		1.5,
		16 / 9,
		5 / 4,
		2
	][widthMode - 1]);
}
var JXLStream = {
	validate: (input) => {
		return toHexString(input, 0, 2) === "ff0a";
	},
	calculate(input) {
		const reader = new BitReader(input, "little-endian");
		const isSmallImage = reader.getBits(1) === 1;
		const height = calculateImageDimension(reader, isSmallImage);
		return {
			width: calculateImageWidth(reader, isSmallImage, reader.getBits(3), height),
			height
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/jxl.js
/** Extracts the codestream from a containerized JPEG XL image */
function extractCodestream(input) {
	const jxlcBox = findBox(input, "jxlc", 0);
	if (jxlcBox && jxlcBox.size >= 8) return input.slice(jxlcBox.offset + 8, jxlcBox.offset + jxlcBox.size);
	const partialStreams = extractPartialStreams(input);
	if (partialStreams.length > 0) return concatenateCodestreams(partialStreams);
}
/** Extracts partial codestreams from jxlp boxes */
function extractPartialStreams(input) {
	const partialStreams = [];
	let offset = 0;
	while (offset < input.length) {
		const jxlpBox = findBox(input, "jxlp", offset);
		if (!jxlpBox) break;
		if (jxlpBox.size < 12) break;
		partialStreams.push(input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size));
		const nextOffset = jxlpBox.offset + jxlpBox.size;
		if (nextOffset <= offset) break;
		offset = nextOffset;
	}
	return partialStreams;
}
/** Concatenates partial codestreams into a single codestream */
function concatenateCodestreams(partialCodestreams) {
	const totalLength = partialCodestreams.reduce((acc, curr) => acc + curr.length, 0);
	const codestream = new Uint8Array(totalLength);
	let position = 0;
	for (const partial of partialCodestreams) {
		codestream.set(partial, position);
		position += partial.length;
	}
	return codestream;
}
var JXL = {
	validate: (input) => {
		if (toUTF8String(input, 4, 8) !== "JXL ") return false;
		const ftypBox = findBox(input, "ftyp", 0);
		if (!ftypBox) return false;
		return toUTF8String(input, ftypBox.offset + 8, ftypBox.offset + 12) === "jxl ";
	},
	calculate(input) {
		const codestream = extractCodestream(input);
		if (codestream) return JXLStream.calculate(codestream);
		throw new Error("No codestream found in JXL container");
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/ktx.js
var KTX = {
	validate: (input) => {
		const signature = toUTF8String(input, 1, 7);
		return ["KTX 11", "KTX 20"].includes(signature);
	},
	calculate: (input) => {
		const type = input[5] === 49 ? "ktx" : "ktx2";
		const offset = type === "ktx" ? 36 : 20;
		return {
			height: readUInt32LE(input, offset + 4),
			width: readUInt32LE(input, offset),
			type
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/png.js
var pngSignature = "PNG\r\n\n";
var pngImageHeaderChunkName = "IHDR";
var pngFriedChunkName = "CgBI";
var PNG = {
	validate(input) {
		if (pngSignature === toUTF8String(input, 1, 8)) {
			let chunkName = toUTF8String(input, 12, 16);
			if (chunkName === pngFriedChunkName) chunkName = toUTF8String(input, 28, 32);
			if (chunkName !== pngImageHeaderChunkName) throw new TypeError("Invalid PNG");
			return true;
		}
		return false;
	},
	calculate(input) {
		if (toUTF8String(input, 12, 16) === pngFriedChunkName) return {
			height: readUInt32BE(input, 36),
			width: readUInt32BE(input, 32)
		};
		return {
			height: readUInt32BE(input, 20),
			width: readUInt32BE(input, 16)
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/pnm.js
var PNMTypes = {
	P1: "pbm/ascii",
	P2: "pgm/ascii",
	P3: "ppm/ascii",
	P4: "pbm",
	P5: "pgm",
	P6: "ppm",
	P7: "pam",
	PF: "pfm"
};
var handlers = {
	default: (lines) => {
		let dimensions = [];
		while (lines.length > 0) {
			const line = lines.shift();
			if (line[0] === "#") continue;
			dimensions = line.split(" ");
			break;
		}
		if (dimensions.length === 2) return {
			height: Number.parseInt(dimensions[1], 10),
			width: Number.parseInt(dimensions[0], 10)
		};
		throw new TypeError("Invalid PNM");
	},
	pam: (lines) => {
		const size = {};
		while (lines.length > 0) {
			const line = lines.shift();
			if (line.length > 16 || line.charCodeAt(0) > 128) continue;
			const [key, value] = line.split(" ");
			if (key && value) size[key.toLowerCase()] = Number.parseInt(value, 10);
			if (size.height && size.width) break;
		}
		if (size.height && size.width) return {
			height: size.height,
			width: size.width
		};
		throw new TypeError("Invalid PAM");
	}
};
var PNM = {
	validate: (input) => toUTF8String(input, 0, 2) in PNMTypes,
	calculate(input) {
		const type = PNMTypes[toUTF8String(input, 0, 2)];
		const lines = toUTF8String(input, 3).split(/[\r\n]+/);
		return (handlers[type] || handlers.default)(lines);
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/psd.js
var PSD = {
	validate: (input) => toUTF8String(input, 0, 4) === "8BPS",
	calculate: (input) => ({
		height: readUInt32BE(input, 14),
		width: readUInt32BE(input, 18)
	})
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/svg.js
var svgReg = /<svg\s([^>"']|"[^"]*"|'[^']*')*>/;
var extractorRegExps = {
	height: /\sheight=(['"])([^%]+?)\1/,
	root: svgReg,
	viewbox: /\sviewBox=(['"])(.+?)\1/i,
	width: /\swidth=(['"])([^%]+?)\1/
};
var INCH_CM = 2.54;
var units = {
	in: 96,
	cm: 96 / INCH_CM,
	em: 16,
	ex: 8,
	m: 96 / INCH_CM * 100,
	mm: 96 / INCH_CM / 10,
	pc: 96 / 72 / 12,
	pt: 96 / 72,
	px: 1
};
var unitsReg = new RegExp(`^([0-9.]+(?:e\\d+)?)(${Object.keys(units).join("|")})?$`);
function parseLength(len) {
	const m = unitsReg.exec(len);
	if (!m) return;
	return Math.round(Number(m[1]) * (units[m[2]] || 1));
}
function parseViewbox(viewbox) {
	const bounds = viewbox.split(" ");
	return {
		height: parseLength(bounds[3]),
		width: parseLength(bounds[2])
	};
}
function parseAttributes(root) {
	const width = extractorRegExps.width.exec(root);
	const height = extractorRegExps.height.exec(root);
	const viewbox = extractorRegExps.viewbox.exec(root);
	return {
		height: height && parseLength(height[2]),
		viewbox: viewbox && parseViewbox(viewbox[2]),
		width: width && parseLength(width[2])
	};
}
function calculateByDimensions(attrs) {
	return {
		height: attrs.height,
		width: attrs.width
	};
}
function calculateByViewbox(attrs, viewbox) {
	const ratio = viewbox.width / viewbox.height;
	if (attrs.width) return {
		height: Math.floor(attrs.width / ratio),
		width: attrs.width
	};
	if (attrs.height) return {
		height: attrs.height,
		width: Math.floor(attrs.height * ratio)
	};
	return {
		height: viewbox.height,
		width: viewbox.width
	};
}
var SVG = {
	validate: (input) => svgReg.test(toUTF8String(input, 0, 1e3)),
	calculate(input) {
		const root = extractorRegExps.root.exec(toUTF8String(input));
		if (root) {
			const attrs = parseAttributes(root[0]);
			if (attrs.width != null && attrs.height != null) return calculateByDimensions(attrs);
			if (attrs.viewbox) return calculateByViewbox(attrs, attrs.viewbox);
		}
		throw new TypeError("Invalid SVG");
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/tga.js
var TGA = {
	validate(input) {
		return readUInt16LE(input, 0) === 0 && readUInt16LE(input, 4) === 0;
	},
	calculate(input) {
		return {
			height: readUInt16LE(input, 14),
			width: readUInt16LE(input, 12)
		};
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/tiff.js
var CONSTANTS = {
	TAG: {
		WIDTH: 256,
		HEIGHT: 257,
		COMPRESSION: 259
	},
	TYPE: {
		SHORT: 3,
		LONG: 4,
		LONG8: 16
	},
	ENTRY_SIZE: {
		STANDARD: 12,
		BIG: 20
	},
	COUNT_SIZE: {
		STANDARD: 2,
		BIG: 8
	}
};
function readIFD(input, { isBigEndian, isBigTiff }) {
	const ifdOffset = isBigTiff ? Number(readUInt64(input, 8, isBigEndian)) : readUInt(input, 32, 4, isBigEndian);
	const entryCountSize = isBigTiff ? CONSTANTS.COUNT_SIZE.BIG : CONSTANTS.COUNT_SIZE.STANDARD;
	return input.slice(ifdOffset + entryCountSize);
}
function readTagValue(input, type, offset, isBigEndian) {
	switch (type) {
		case CONSTANTS.TYPE.SHORT: return readUInt(input, 16, offset, isBigEndian);
		case CONSTANTS.TYPE.LONG: return readUInt(input, 32, offset, isBigEndian);
		case CONSTANTS.TYPE.LONG8: {
			const value = Number(readUInt64(input, offset, isBigEndian));
			if (value > Number.MAX_SAFE_INTEGER) throw new TypeError("Value too large");
			return value;
		}
		default: return 0;
	}
}
function nextTag(input, isBigTiff) {
	const entrySize = isBigTiff ? CONSTANTS.ENTRY_SIZE.BIG : CONSTANTS.ENTRY_SIZE.STANDARD;
	if (input.length > entrySize) return input.slice(entrySize);
}
function extractTags(input, { isBigEndian, isBigTiff }) {
	const tags = {};
	let temp = input;
	while (temp?.length) {
		const code = readUInt(temp, 16, 0, isBigEndian);
		const type = readUInt(temp, 16, 2, isBigEndian);
		const length = isBigTiff ? Number(readUInt64(temp, 4, isBigEndian)) : readUInt(temp, 32, 4, isBigEndian);
		if (code === 0) break;
		if (length === 1 && (type === CONSTANTS.TYPE.SHORT || type === CONSTANTS.TYPE.LONG || isBigTiff && type === CONSTANTS.TYPE.LONG8)) tags[code] = readTagValue(temp, type, isBigTiff ? 12 : 8, isBigEndian);
		temp = nextTag(temp, isBigTiff);
	}
	return tags;
}
function determineFormat(input) {
	const signature = toUTF8String(input, 0, 2);
	const version = readUInt(input, 16, 2, signature === "MM");
	return {
		isBigEndian: signature === "MM",
		isBigTiff: version === 43
	};
}
function validateBigTIFFHeader(input, isBigEndian) {
	const byteSize = readUInt(input, 16, 4, isBigEndian);
	const reserved = readUInt(input, 16, 6, isBigEndian);
	if (byteSize !== 8 || reserved !== 0) throw new TypeError("Invalid BigTIFF header");
}
var signatures = /* @__PURE__ */ new Set([
	"49492a00",
	"4d4d002a",
	"49492b00",
	"4d4d002b"
]);
var TIFF = {
	validate: (input) => {
		const signature = toHexString(input, 0, 4);
		return signatures.has(signature);
	},
	calculate(input) {
		const format = determineFormat(input);
		if (format.isBigTiff) validateBigTIFFHeader(input, format.isBigEndian);
		const tags = extractTags(readIFD(input, format), format);
		const info = {
			height: tags[CONSTANTS.TAG.HEIGHT],
			width: tags[CONSTANTS.TAG.WIDTH],
			type: format.isBigTiff ? "bigtiff" : "tiff"
		};
		if (tags[CONSTANTS.TAG.COMPRESSION]) info.compression = tags[CONSTANTS.TAG.COMPRESSION];
		if (!info.width || !info.height) throw new TypeError("Invalid Tiff. Missing tags");
		return info;
	}
};
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/webp.js
function calculateExtended(input) {
	return {
		height: 1 + readUInt24LE(input, 7),
		width: 1 + readUInt24LE(input, 4)
	};
}
function calculateLossless(input) {
	return {
		height: 1 + ((input[4] & 15) << 10 | input[3] << 2 | (input[2] & 192) >> 6),
		width: 1 + ((input[2] & 63) << 8 | input[1])
	};
}
function calculateLossy(input) {
	return {
		height: readInt16LE(input, 8) & 16383,
		width: readInt16LE(input, 6) & 16383
	};
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/types/index.js
var typeHandlers = /* @__PURE__ */ new Map([
	["bmp", BMP],
	["cur", CUR],
	["dds", DDS],
	["gif", GIF],
	["heif", HEIF],
	["icns", ICNS],
	["ico", ICO],
	["j2c", J2C],
	["jp2", JP2],
	["jpg", JPG],
	["jxl", JXL],
	["jxl-stream", JXLStream],
	["ktx", KTX],
	["png", PNG],
	["pnm", PNM],
	["psd", PSD],
	["svg", SVG],
	["tga", TGA],
	["tiff", TIFF],
	["webp", {
		validate(input) {
			const riffHeader = "RIFF" === toUTF8String(input, 0, 4);
			const webpHeader = "WEBP" === toUTF8String(input, 8, 12);
			const vp8Header = "VP8" === toUTF8String(input, 12, 15);
			return riffHeader && webpHeader && vp8Header;
		},
		calculate(_input) {
			const chunkHeader = toUTF8String(_input, 12, 16);
			const input = _input.slice(20, 30);
			if (chunkHeader === "VP8X") {
				const extendedHeader = input[0];
				const validStart = (extendedHeader & 192) === 0;
				const validEnd = (extendedHeader & 1) === 0;
				if (validStart && validEnd) return calculateExtended(input);
				throw new TypeError("Invalid WebP");
			}
			if (chunkHeader === "VP8 " && input[0] !== 47) return calculateLossy(input);
			const signature = toHexString(input, 3, 6);
			if (chunkHeader === "VP8L" && signature !== "9d012a") return calculateLossless(input);
			throw new TypeError("Invalid WebP");
		}
	}]
]);
var types = Array.from(typeHandlers.keys());
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/detector.js
var firstBytes = /* @__PURE__ */ new Map([
	[0, "heif"],
	[56, "psd"],
	[66, "bmp"],
	[68, "dds"],
	[71, "gif"],
	[73, "tiff"],
	[77, "tiff"],
	[82, "webp"],
	[105, "icns"],
	[137, "png"],
	[255, "jpg"]
]);
function detector(input) {
	const byte = input[0];
	const type = firstBytes.get(byte);
	if (type && typeHandlers.get(type).validate(input)) return type;
	return types.find((imageType) => typeHandlers.get(imageType).validate(input));
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/vendor/image-size/lookup.js
/**
* Return size information based on an Uint8Array
*
* @param {Uint8Array} input
* @returns {ISizeCalculationResult}
*/
function lookup(input) {
	const type = detector(input);
	if (typeof type !== "undefined") {
		const size = typeHandlers.get(type).calculate(input);
		if (size !== void 0) {
			size.type = size.type ?? type;
			return size;
		}
	}
	throw new TypeError("unsupported file type: " + type);
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/metadata.js
/**
* Extracts image metadata such as dimensions, format, and orientation from the provided image data.
*
* @param {Uint8Array} data - The binary data of the image.
* @param {string} [src] - The source path or URL of the image, used for error messages. Optional.
* @return {Promise<Omit<ImageMetadata, 'src' | 'fsPath'>>} A promise that resolves with the extracted metadata, excluding `src` and `fsPath`.
* @throws {AstroError} Throws an error if the image metadata cannot be extracted.
*/
async function imageMetadata(data, src) {
	let result;
	try {
		result = lookup(data);
	} catch {
		throw new AstroError({
			...NoImageMetadata,
			message: NoImageMetadata.message(src)
		});
	}
	if (result.height == null || result.width == null || !result.type) throw new AstroError({
		...NoImageMetadata,
		message: NoImageMetadata.message(src)
	});
	const { width, height, type, orientation } = result;
	const isPortrait = (orientation || 0) >= 5;
	return {
		width: isPortrait ? height : width,
		height: isPortrait ? width : height,
		format: type,
		orientation
	};
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/redirectValidation.js
/**
* Recursively follows HTTP redirects with validation according to the image configuration.
*
* If any of the domains in the redirect chain are not allowed by either `image.remotePatterns`
* or `image.domains`, this function will throw an error for a disallowed redirect.
*
* @param options The options for this fetch call.
*/
async function fetchWithRedirects(options) {
	const { url, headers, imageConfig, fetchFn = globalThis.fetch, redirectLimit = 10, onMaxRedirectsExceeded = (_u) => /* @__PURE__ */ new Error("Maximum redirect depth exceeded"), onMissingLocationHeader = (_s, _u) => /* @__PURE__ */ new Error(`Redirect response ${_s} missing Location header`), onDisallowedRedirect = (_current, _target) => /* @__PURE__ */ new Error(`The image at ${_current} redirected to ${_target}, which is not an allowed remote location.`) } = options;
	if (redirectLimit <= 0) throw onMaxRedirectsExceeded(typeof url === "string" ? url : url.toString());
	const urlString = typeof url === "string" ? url : url.toString();
	const res = await fetchFn(new Request(url, { headers }), { redirect: "manual" });
	if ([
		301,
		302,
		303,
		307,
		308
	].includes(res.status)) {
		const location = res.headers.get("Location");
		if (!location) throw onMissingLocationHeader(res.status, urlString);
		const redirectUrl = new URL(location, urlString).toString();
		if (!isRemoteAllowed(redirectUrl, {
			domains: imageConfig.domains ?? [],
			remotePatterns: imageConfig.remotePatterns ?? []
		})) throw onDisallowedRedirect(urlString, redirectUrl);
		return fetchWithRedirects({
			url: redirectUrl,
			headers,
			imageConfig,
			fetchFn,
			redirectLimit: redirectLimit - 1,
			onMaxRedirectsExceeded,
			onMissingLocationHeader,
			onDisallowedRedirect
		});
	}
	return res;
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/remoteProbe.js
/**
* Infers the dimensions of a remote image by streaming its data and analyzing it progressively until sufficient metadata is available.
*
* @param {string} url - The URL of the remote image from which to infer size metadata.
* @param {RemoteImageConfig} [imageConfig] - Optional image config used to validate remote allowlists.
* @return {Promise<Omit<ImageMetadata, 'src' | 'fsPath'>>} Returns a promise that resolves to an object containing the image dimensions metadata excluding `src` and `fsPath`.
* @throws {AstroError} Thrown when the fetching fails or metadata cannot be extracted.
*/
async function inferRemoteSize$1(url, imageConfig) {
	if (!URL.canParse(url)) throw new AstroError({
		...FailedToFetchRemoteImageDimensions,
		message: FailedToFetchRemoteImageDimensions.message(url)
	});
	const allowlistConfig = imageConfig ? {
		domains: imageConfig.domains ?? [],
		remotePatterns: imageConfig.remotePatterns ?? []
	} : void 0;
	if (!allowlistConfig) {
		const parsedUrl = new URL(url);
		if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new AstroError({
			...FailedToFetchRemoteImageDimensions,
			message: FailedToFetchRemoteImageDimensions.message(url)
		});
	}
	if (allowlistConfig && !isRemoteAllowed(url, allowlistConfig)) throw new AstroError({
		...RemoteImageNotAllowed,
		message: RemoteImageNotAllowed.message(url)
	});
	let response;
	try {
		response = await fetchWithRedirects({
			url,
			onMaxRedirectsExceeded: (u) => new AstroError({
				...FailedToFetchRemoteImageDimensions,
				message: FailedToFetchRemoteImageDimensions.message(u)
			}),
			onMissingLocationHeader: (_status, u) => new AstroError({
				...FailedToFetchRemoteImageDimensions,
				message: FailedToFetchRemoteImageDimensions.message(u)
			}),
			imageConfig: imageConfig ?? {
				remotePatterns: [],
				domains: []
			}
		});
	} catch (_err) {
		throw new AstroError({
			...FailedToFetchRemoteImageDimensions,
			message: FailedToFetchRemoteImageDimensions.message(url)
		});
	}
	if (allowlistConfig && !isRemoteAllowed(response.url, allowlistConfig)) throw new AstroError({
		...RemoteImageNotAllowed,
		message: RemoteImageNotAllowed.message(url)
	});
	if (!response.body || !response.ok) throw new AstroError({
		...FailedToFetchRemoteImageDimensions,
		message: FailedToFetchRemoteImageDimensions.message(url)
	});
	const reader = response.body.getReader();
	let done, value;
	let accumulatedChunks = /* @__PURE__ */ new Uint8Array();
	while (!done) {
		const readResult = await reader.read();
		done = readResult.done;
		if (done) break;
		if (readResult.value) {
			value = readResult.value;
			let tmp = new Uint8Array(accumulatedChunks.length + value.length);
			tmp.set(accumulatedChunks, 0);
			tmp.set(value, accumulatedChunks.length);
			accumulatedChunks = tmp;
			try {
				const dimensions = await imageMetadata(accumulatedChunks, url);
				if (dimensions) {
					await reader.cancel();
					return dimensions;
				}
			} catch {}
		}
	}
	throw new AstroError({
		...NoImageMetadata,
		message: NoImageMetadata.message(url)
	});
}
// ../Alga Meet/node_modules/astro/dist/assets/services/service.js
function isLocalService(service) {
	if (!service) return false;
	return "transform" in service;
}
function parseQuality(quality) {
	let result = Number.parseInt(quality);
	if (Number.isNaN(result)) return quality;
	return result;
}
var sortNumeric = (a, b) => a - b;
function verifyOptions(options) {
	if (!options.src || !isRemoteImage(options.src) && !isESMImportedImage(options.src)) throw new AstroError({
		...ExpectedImage,
		message: ExpectedImage.message(JSON.stringify(options.src), typeof options.src, JSON.stringify(options, (_, v) => v === void 0 ? null : v))
	});
	if (!isESMImportedImage(options.src)) {
		if (options.src.startsWith("/@fs/") || !isRemotePath(options.src) && !options.src.startsWith("/")) throw new AstroError({
			...LocalImageUsedWrongly,
			message: LocalImageUsedWrongly.message(options.src)
		});
		let missingDimension;
		if (!options.width && !options.height) missingDimension = "both";
		else if (!options.width && options.height) missingDimension = "width";
		else if (options.width && !options.height) missingDimension = "height";
		if (missingDimension) throw new AstroError({
			...MissingImageDimension,
			message: MissingImageDimension.message(missingDimension, options.src)
		});
	} else {
		if (!VALID_SUPPORTED_FORMATS.includes(options.src.format)) throw new AstroError({
			...UnsupportedImageFormat,
			message: UnsupportedImageFormat.message(options.src.format, options.src.src, VALID_SUPPORTED_FORMATS)
		});
		if (options.widths && options.densities) throw new AstroError(IncompatibleDescriptorOptions);
		if (options.src.format !== "svg" && options.format === "svg") throw new AstroError(UnsupportedImageConversion);
	}
}
/**
* Basic local service using the included `_image` endpoint.
* This service intentionally does not implement `transform`.
*
* Example usage:
* ```ts
* const service = {
*  getURL: baseService.getURL,
*  parseURL: baseService.parseURL,
*  getHTMLAttributes: baseService.getHTMLAttributes,
*  async transform(inputBuffer, transformOptions) {...}
* }
* ```
*
* This service adhere to the included services limitations:
* - Only a limited amount of formats are supported.
* - For remote images, `width` and `height` are always required.
*
*/
var baseService = {
	propertiesToHash: DEFAULT_HASH_PROPS,
	validateOptions(options) {
		verifyOptions(options);
		if (!options.format) {
			if (isESMImportedImage(options.src)) options.format = resolveDefaultOutputFormat(options.src.format);
			else {
				const inferred = inferSourceFormat(options.src);
				if (inferred) options.format = resolveDefaultOutputFormat(inferred);
			}
		}
		if (options.width) options.width = Math.round(options.width);
		if (options.height) options.height = Math.round(options.height);
		if (options.layout) delete options.layout;
		if (options.fit === "none") delete options.fit;
		return options;
	},
	getHTMLAttributes(options) {
		const { targetWidth, targetHeight } = getTargetDimensions(options);
		const { src, width, height, format, quality, densities, widths, formats, layout, priority, fit, position, background, ...attributes } = options;
		return {
			...attributes,
			width: targetWidth,
			height: targetHeight,
			loading: attributes.loading ?? "lazy",
			decoding: attributes.decoding ?? "async"
		};
	},
	getSrcSet(options) {
		const { targetWidth, targetHeight } = getTargetDimensions(options);
		const aspectRatio = targetWidth / targetHeight;
		const { widths, densities } = options;
		const targetFormat = options.format;
		let transformedWidths = (widths ?? []).sort(sortNumeric);
		let imageWidth = options.width;
		let maxWidth = Number.POSITIVE_INFINITY;
		if (isESMImportedImage(options.src)) {
			imageWidth = options.src.width;
			maxWidth = imageWidth;
			if (transformedWidths.length > 0 && transformedWidths.at(-1) > maxWidth) {
				transformedWidths = transformedWidths.filter((width) => width <= maxWidth);
				transformedWidths.push(maxWidth);
			}
		}
		transformedWidths = Array.from(new Set(transformedWidths));
		const { width: transformWidth, height: transformHeight, ...transformWithoutDimensions } = options;
		let allWidths = [];
		if (densities) {
			const densityValues = Array.from(new Set(densities.map((density) => {
				if (typeof density === "number") return density;
				else return Number.parseFloat(density);
			})));
			allWidths = densityValues.sort(sortNumeric).map((density) => Math.round(targetWidth * density)).map((width, index) => ({
				width,
				descriptor: `${densityValues[index]}x`
			}));
		} else if (transformedWidths.length > 0) allWidths = transformedWidths.map((width) => ({
			width,
			descriptor: `${width}w`
		}));
		return allWidths.map(({ width, descriptor }) => {
			const height = Math.round(width / aspectRatio);
			return {
				transform: {
					...transformWithoutDimensions,
					width,
					height
				},
				descriptor,
				attributes: targetFormat ? { type: `image/${targetFormat}` } : {}
			};
		});
	},
	getURL(options, imageConfig) {
		const searchParams = new URLSearchParams();
		if (isESMImportedImage(options.src)) searchParams.append("href", options.src.src);
		else if (isRemoteAllowed(options.src, imageConfig)) searchParams.append("href", options.src);
		else return options.src;
		Object.entries({
			w: "width",
			h: "height",
			q: "quality",
			f: "format",
			fit: "fit",
			position: "position",
			background: "background"
		}).forEach(([param, key]) => {
			options[key] && searchParams.append(param, options[key].toString());
		});
		let url = `${joinPaths("/", imageConfig.endpoint.route)}?${searchParams}`;
		if (imageConfig.assetQueryParams) {
			const assetQueryString = imageConfig.assetQueryParams.toString();
			if (assetQueryString) url += "&" + assetQueryString;
		}
		return url;
	},
	parseURL(url) {
		const params = url.searchParams;
		if (!params.has("href")) return;
		return {
			src: params.get("href"),
			width: params.has("w") ? Number.parseInt(params.get("w")) : void 0,
			height: params.has("h") ? Number.parseInt(params.get("h")) : void 0,
			format: params.has("f") ? params.get("f") : void 0,
			quality: params.get("q"),
			fit: params.get("fit"),
			position: params.get("position") ?? void 0,
			background: params.get("background") ?? void 0
		};
	},
	getRemoteSize(url, imageConfig) {
		return inferRemoteSize$1(url, imageConfig);
	}
};
/**
* Returns the final dimensions of an image based on the user's options.
*
* For local images:
* - If the user specified both width and height, we'll use those.
* - If the user specified only one of them, we'll use the original image's aspect ratio to calculate the other.
* - If the user didn't specify either, we'll use the original image's dimensions.
*
* For remote images:
* - Widths and heights are always required, so we'll use the user's specified width and height.
*/
function getTargetDimensions(options) {
	let targetWidth = options.width;
	let targetHeight = options.height;
	if (isESMImportedImage(options.src)) {
		const aspectRatio = options.src.width / options.src.height;
		if (targetHeight && !targetWidth) targetWidth = Math.round(targetHeight * aspectRatio);
		else if (targetWidth && !targetHeight) targetHeight = Math.round(targetWidth / aspectRatio);
		else if (!targetWidth && !targetHeight) {
			targetWidth = options.src.width;
			targetHeight = options.src.height;
		}
	}
	return {
		targetWidth,
		targetHeight
	};
}
// ../Alga Meet/node_modules/astro/dist/assets/types.js
function isImageMetadata(src) {
	return !!src.fsPath && !Object.prototype.propertyIsEnumerable.call(src, "fsPath");
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/image-asset.js
var RAW_SRC = Symbol.for("astro:image-asset:raw-src");
function createImageAsset(metadata, fsPath, track) {
	const asset = { ...metadata };
	Object.defineProperty(asset, "fsPath", {
		value: fsPath,
		enumerable: false
	});
	if (track) {
		let src = metadata.src;
		Object.defineProperty(asset, RAW_SRC, { get: () => src });
		Object.defineProperty(asset, "src", {
			enumerable: true,
			configurable: true,
			get() {
				recordReferencedImage(fsPath);
				return src;
			},
			set(value) {
				src = value;
			}
		});
	} else Object.defineProperty(asset, RAW_SRC, { get: () => asset.src });
	return asset;
}
function getUntrackedImage(image) {
	if (typeof image !== "object" || image === null || !(RAW_SRC in image)) return image;
	const asset = image;
	const copy = {};
	for (const key of Object.keys(asset)) copy[key] = key === "src" ? asset[RAW_SRC] : asset[key];
	Object.defineProperty(copy, "fsPath", {
		value: asset.fsPath,
		enumerable: false
	});
	return copy;
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/deterministic-string.js
/**
* Vendored from deterministic-object-hash@2.0.2 (MIT)
* https://github.com/nicholasgasior/deterministic-object-hash
*
* Only `deterministicString` is needed - the async `deterministicHash` (which
* pulls in `node:crypto`) is intentionally excluded so this module stays
* runtime-agnostic (works in Node, workerd, browsers, etc.).
*/
var objConstructorString = Function.prototype.toString.call(Object);
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Object.prototype.toString.call(value) !== "[object Object]") return false;
	const proto = Object.getPrototypeOf(value);
	if (proto === null) return true;
	if (!Object.prototype.hasOwnProperty.call(proto, "constructor")) return false;
	return typeof proto.constructor === "function" && proto.constructor instanceof proto.constructor && Function.prototype.toString.call(proto.constructor) === objConstructorString;
}
/** Recursively serializes any JS value into a deterministic string. */
function deterministicString(input) {
	if (typeof input === "string") return JSON.stringify(input);
	else if (typeof input === "symbol" || typeof input === "function") return input.toString();
	else if (typeof input === "bigint") return `${input}n`;
	else if (input === globalThis || input === void 0 || input === null || typeof input === "boolean" || typeof input === "number" || typeof input !== "object") return `${input}`;
	else if (input instanceof Date) return `(${input.constructor.name}:${input.getTime()})`;
	else if (input instanceof RegExp || input instanceof Error || input instanceof WeakMap || input instanceof WeakSet) return `(${input.constructor.name}:${input.toString()})`;
	else if (input instanceof Set) {
		let ret = `(${input.constructor.name}:[`;
		for (const val of input.values()) ret += `${deterministicString(val)},`;
		ret += "])";
		return ret;
	} else if (Array.isArray(input) || input instanceof Int8Array || input instanceof Uint8Array || input instanceof Uint8ClampedArray || input instanceof Int16Array || input instanceof Uint16Array || input instanceof Int32Array || input instanceof Uint32Array || input instanceof Float32Array || input instanceof Float64Array || input instanceof BigInt64Array || input instanceof BigUint64Array) {
		let ret = `(${input.constructor.name}:[`;
		for (const [k, v] of input.entries()) ret += `(${k}:${deterministicString(v)}),`;
		ret += "])";
		return ret;
	} else if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
		if (input.byteLength % 8 === 0) return deterministicString(new BigUint64Array(input));
		else if (input.byteLength % 4 === 0) return deterministicString(new Uint32Array(input));
		else if (input.byteLength % 2 === 0) return deterministicString(new Uint16Array(input));
		else {
			let ret = "(";
			for (let i = 0; i < input.byteLength; i++) ret += `${deterministicString(new Uint8Array(input.slice(i, i + 1)))},`;
			ret += ")";
			return ret;
		}
	} else if (input instanceof Map || isPlainObject(input)) {
		const sortable = [];
		const entries = input instanceof Map ? input.entries() : Object.entries(input);
		for (const [k, v] of entries) sortable.push([deterministicString(k), deterministicString(v)]);
		if (!(input instanceof Map)) {
			const symbolKeys = Object.getOwnPropertySymbols(input);
			for (let i = 0; i < symbolKeys.length; i++) sortable.push([deterministicString(symbolKeys[i]), deterministicString(input[symbolKeys[i]])]);
		}
		sortable.sort(([a], [b]) => a.localeCompare(b));
		let ret = `(${input.constructor.name}:[`;
		for (const [k, v] of sortable) ret += `(${k}:${v}),`;
		ret += "])";
		return ret;
	}
	const allEntries = [];
	for (const k in input) allEntries.push([deterministicString(k), deterministicString(input[k])]);
	const symbolKeys = Object.getOwnPropertySymbols(input);
	for (let i = 0; i < symbolKeys.length; i++) allEntries.push([deterministicString(symbolKeys[i]), deterministicString(input[symbolKeys[i]])]);
	allEntries.sort(([a], [b]) => a.localeCompare(b));
	let ret = `(${input.constructor.name}:[`;
	for (const [k, v] of allEntries) ret += `(${k}:${v}),`;
	ret += "])";
	return ret;
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/hash.js
var INVALID_CHAR_REGEX = /[\u0000-\u001F"#$%&*+,:;<=>?[\]^`{|}\u007F]/g;
/** Pure-string replacement for `path.posix.basename` (no node: import). */
function basename(filePath, ext) {
	let end = filePath.length;
	while (end > 0 && filePath[end - 1] === "/") end--;
	const stripped = filePath.slice(0, end);
	const lastSlash = stripped.lastIndexOf("/");
	const base = lastSlash === -1 ? stripped : stripped.slice(lastSlash + 1);
	if (ext && base.endsWith(ext)) return base.slice(0, base.length - ext.length);
	return base;
}
/** Pure-string replacement for `path.posix.dirname` (no node: import). */
function dirname(filePath) {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash === -1) return ".";
	if (lastSlash === 0) return "/";
	return filePath.slice(0, lastSlash);
}
/** Pure-string replacement for `path.posix.extname` (no node: import). */
function extname(filePath) {
	const base = basename(filePath);
	const dotIndex = base.lastIndexOf(".");
	if (dotIndex <= 0) return "";
	return base.slice(dotIndex);
}
/**
* Converts a file path and transformation properties into a formatted filename.
*
* `<prefixDirname>/<baseFilename>_<hash><outputExtension>`
*/
function propsToFilename(filePath, transform, hash) {
	let filename = decodeURIComponent(removeQueryString(filePath));
	const ext = extname(filename);
	if (filePath.startsWith("data:")) filename = shorthash(filePath);
	else filename = basename(filename, ext).replace(INVALID_CHAR_REGEX, "_");
	const prefixDirname = isESMImportedImage(transform.src) ? dirname(filePath) : "";
	let outputExt = transform.format ? `.${transform.format}` : ext;
	return `${prefixDirname}/${filename}_${hash}${outputExt}`;
}
/** Hashes the subset of transform properties that affect the output image. */
function hashTransform(transform, imageService, propertiesToHash) {
	const hashFields = propertiesToHash.reduce((acc, prop) => {
		acc[prop] = transform[prop];
		return acc;
	}, { imageService });
	return shorthash(deterministicString(hashFields));
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/url.js
/**
* Placeholder base URL used when creating URL objects from relative paths.
* This avoids collisions with actual URLs (e.g., absolute asset prefixes like 'http://localhost:4321')
*/
var PLACEHOLDER_BASE = "astro://placeholder";
/**
* Creates a URL object from a path or URL string, using a placeholder base for relative paths.
* This allows safe manipulation of URLs using the native URL API.
*
* @param pathOrUrl - A relative path (e.g., '/_astro/image.png') or absolute URL (e.g., 'https://cdn.example.com/...')
* @returns A URL object that can be safely manipulated
*/
function createPlaceholderURL(pathOrUrl) {
	return new URL(pathOrUrl, PLACEHOLDER_BASE);
}
/**
* Extracts the pathname and search parameters from a URL created with `createPlaceholderURL`.
* Removes the placeholder base, returning just the path and query string.
*
* @param url - A URL object created with `createPlaceholderURL`
* @returns The URL string without the placeholder base
*/
function stringifyPlaceholderURL(url) {
	return url.href.replace(PLACEHOLDER_BASE, "");
}
// ../Alga Meet/node_modules/astro/dist/assets/utils/static-image.js
function resolveStaticImage(options, hashProperties, originalFSPath, config) {
	const ESMImportedImageSrc = isESMImportedImage(options.src) ? options.src.src : options.src;
	const assetPrefix = getAssetsPrefix(fileExtension(ESMImportedImageSrc), config.assetsPrefix);
	const finalOriginalPath = removeBase(removeBase(ESMImportedImageSrc, config.base), assetPrefix);
	const hash = hashTransform(options, config.serviceEntrypoint, hashProperties);
	const finalFilePath = prependForwardSlash(joinPaths(isESMImportedImage(options.src) ? "" : config.assetsDir, prependForwardSlash(propsToFilename(finalOriginalPath, options, hash))));
	const url = createPlaceholderURL(config.assetsPrefix ? encodeURI(joinPaths(assetPrefix, finalFilePath)) : encodeURI(prependForwardSlash(joinPaths(config.base, finalFilePath))));
	if (config.assetQueryParams) config.assetQueryParams.forEach((value, key) => {
		url.searchParams.set(key, value);
	});
	return {
		url: stringifyPlaceholderURL(url),
		image: {
			originalPath: finalOriginalPath,
			hash,
			finalPath: finalFilePath,
			originalSrcPath: originalFSPath,
			transform: typeof options.src === "function" ? {
				...options,
				src: { ...options.src }
			} : options
		}
	};
}
// ../Alga Meet/node_modules/astro/dist/assets/internal.js
var cssFitValues = [
	"fill",
	"contain",
	"cover",
	"scale-down"
];
var configuredImageService;
async function getConfiguredImageService() {
	if (!configuredImageService) {
		const { default: service } = await import("./sharp_Cmsh9GJB.mjs").catch((e) => {
			const error = new AstroError(InvalidImageService);
			error.cause = e;
			throw error;
		});
		configuredImageService = service;
	}
	return configuredImageService;
}
function getStaticImageConfig(imageConfig) {
	return isCollectingStaticImages() ? imageConfig.staticImageConfig : void 0;
}
async function getImage$1(options, imageConfig, logger) {
	if (!options || typeof options !== "object") throw new AstroError({
		...ExpectedImageOptions,
		message: ExpectedImageOptions.message(JSON.stringify(options))
	});
	if (typeof options.src === "undefined") throw new AstroError({
		...ExpectedImage,
		message: ExpectedImage.message(options.src, "undefined", JSON.stringify(options))
	});
	if (isImageMetadata(options)) throw new AstroError(ExpectedNotESMImage);
	const service = await getConfiguredImageService();
	const resolvedOptions = {
		...options,
		src: await resolveSrc(options.src)
	};
	let originalWidth;
	let originalHeight;
	if (resolvedOptions.inferSize) {
		delete resolvedOptions.inferSize;
		if (isRemoteImage(resolvedOptions.src) && isRemotePath(resolvedOptions.src)) {
			if (!isRemoteAllowed(resolvedOptions.src, imageConfig)) throw new AstroError({
				...RemoteImageNotAllowed,
				message: RemoteImageNotAllowed.message(resolvedOptions.src)
			});
			const getRemoteSize = (url) => service.getRemoteSize?.(url, imageConfig, logger) ?? inferRemoteSize$1(url, imageConfig);
			const result = await getRemoteSize(resolvedOptions.src);
			resolvedOptions.width ??= result.width;
			resolvedOptions.height ??= result.height;
			if (result.format) resolvedOptions.format ??= resolveDefaultOutputFormat(result.format);
			originalWidth = result.width;
			originalHeight = result.height;
		}
	}
	const originalFilePath = isESMImportedImage(resolvedOptions.src) ? resolvedOptions.src.fsPath : void 0;
	const clonedSrc = getUntrackedImage(resolvedOptions.src);
	if (isESMImportedImage(clonedSrc)) {
		originalWidth = clonedSrc.width;
		originalHeight = clonedSrc.height;
	}
	if (originalWidth && originalHeight) {
		const aspectRatio = originalWidth / originalHeight;
		if (resolvedOptions.height && !resolvedOptions.width) resolvedOptions.width = Math.round(resolvedOptions.height * aspectRatio);
		else if (resolvedOptions.width && !resolvedOptions.height) resolvedOptions.height = Math.round(resolvedOptions.width / aspectRatio);
		else if (!resolvedOptions.width && !resolvedOptions.height) {
			resolvedOptions.width = originalWidth;
			resolvedOptions.height = originalHeight;
		}
	}
	resolvedOptions.src = clonedSrc;
	const layout = options.layout ?? imageConfig.layout ?? "none";
	if (resolvedOptions.priority) {
		resolvedOptions.loading ??= "eager";
		resolvedOptions.decoding ??= "sync";
		resolvedOptions.fetchpriority ??= "high";
		delete resolvedOptions.priority;
	} else {
		resolvedOptions.loading ??= "lazy";
		resolvedOptions.decoding ??= "async";
		resolvedOptions.fetchpriority ??= void 0;
	}
	if (layout !== "none") {
		resolvedOptions.widths ||= getWidths({
			width: resolvedOptions.width,
			layout,
			originalWidth,
			breakpoints: imageConfig.breakpoints?.length ? imageConfig.breakpoints : isLocalService(service) ? LIMITED_RESOLUTIONS : DEFAULT_RESOLUTIONS
		});
		resolvedOptions.sizes ||= getSizesAttribute({
			width: resolvedOptions.width,
			layout
		});
		delete resolvedOptions.densities;
		resolvedOptions["data-astro-image"] = layout;
		if (resolvedOptions.fit && cssFitValues.includes(resolvedOptions.fit)) resolvedOptions["data-astro-image-fit"] = resolvedOptions.fit;
		resolvedOptions["data-astro-image-pos"] = (resolvedOptions.position || "center").replace(/\s+/g, "-");
	}
	const validatedOptions = service.validateOptions ? await service.validateOptions(resolvedOptions, imageConfig, logger) : resolvedOptions;
	validatedOptions.format ??= await peekRemoteFormatForStaticEmit(validatedOptions, imageConfig, service, logger);
	const srcSetTransforms = service.getSrcSet ? await service.getSrcSet(validatedOptions, imageConfig, logger) : [];
	const lazyImageURLFactory = (getValue) => {
		let cached = null;
		return () => cached ??= getValue();
	};
	const initialImageURL = await service.getURL(validatedOptions, imageConfig, logger);
	let lazyImageURL = lazyImageURLFactory(() => initialImageURL);
	const matchesValidatedTransform = (transform) => transform.width === validatedOptions.width && transform.height === validatedOptions.height && transform.format === validatedOptions.format;
	let srcSets = await Promise.all(srcSetTransforms.map(async (srcSet) => {
		return {
			transform: srcSet.transform,
			url: matchesValidatedTransform(srcSet.transform) ? initialImageURL : await service.getURL(srcSet.transform, imageConfig, logger),
			descriptor: srcSet.descriptor,
			attributes: srcSet.attributes
		};
	}));
	const staticImageConfig = getStaticImageConfig(imageConfig);
	if (isLocalService(service) && staticImageConfig && !(isRemoteImage(validatedOptions.src) && initialImageURL === validatedOptions.src)) {
		const propsToHash = service.propertiesToHash ?? DEFAULT_HASH_PROPS;
		const addStaticImage = (transform) => {
			const { url, image } = resolveStaticImage(transform, propsToHash, originalFilePath, {
				...staticImageConfig,
				serviceEntrypoint: imageConfig.service.entrypoint,
				assetQueryParams: imageConfig.assetQueryParams
			});
			recordStaticImage(image);
			return url;
		};
		lazyImageURL = lazyImageURLFactory(() => addStaticImage(validatedOptions));
		srcSets = srcSetTransforms.map((srcSet) => {
			return {
				transform: srcSet.transform,
				url: matchesValidatedTransform(srcSet.transform) ? lazyImageURL() : addStaticImage(srcSet.transform),
				descriptor: srcSet.descriptor,
				attributes: srcSet.attributes
			};
		});
	} else if (imageConfig.assetQueryParams) {
		const imageURLObj = createPlaceholderURL(initialImageURL);
		imageConfig.assetQueryParams.forEach((value, key) => {
			imageURLObj.searchParams.set(key, value);
		});
		lazyImageURL = lazyImageURLFactory(() => stringifyPlaceholderURL(imageURLObj));
		srcSets = srcSets.map((srcSet) => {
			const urlObj = createPlaceholderURL(srcSet.url);
			imageConfig.assetQueryParams.forEach((value, key) => {
				urlObj.searchParams.set(key, value);
			});
			return {
				...srcSet,
				url: stringifyPlaceholderURL(urlObj)
			};
		});
	}
	return {
		rawOptions: resolvedOptions,
		options: validatedOptions,
		get src() {
			return lazyImageURL();
		},
		srcSet: {
			values: srcSets,
			attribute: srcSets.map((srcSet) => `${srcSet.url} ${srcSet.descriptor}`).join(", ")
		},
		attributes: service.getHTMLAttributes !== void 0 ? await service.getHTMLAttributes(validatedOptions, imageConfig, logger) : {}
	};
}
/**
* Build-time only: probes the remote URL via `getRemoteSize` so we can commit a real `format`
* before the filename is hashed. Returns undefined when no peek applies (SSR, non-remote,
* disallowed remote, external service, missing `getRemoteSize`, or probe failure) — the
* transform service handles those by detecting from the actual buffer.
*/
async function peekRemoteFormatForStaticEmit(options, imageConfig, service, logger) {
	if (!isRemoteImage(options.src) || !isRemoteAllowed(options.src, imageConfig) || !getStaticImageConfig(imageConfig) || !isLocalService(service) || !service.getRemoteSize) return;
	try {
		return resolveDefaultOutputFormat((await service.getRemoteSize(options.src, imageConfig, logger)).format);
	} catch {
		return;
	}
}
// ../Alga Meet/node_modules/astro/components/Image.astro
createAstro("http://localhost:4599");
// ../Alga Meet/node_modules/astro/components/Picture.astro
createAstro("http://localhost:4599");
var $$Picture = createComponent(async ($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Picture;
	const defaultFormats = ["webp"];
	const defaultFallbackFormat = "png";
	const specialFormatsFallback = [
		"gif",
		"svg",
		"jpg",
		"jpeg"
	];
	const { formats = defaultFormats, pictureAttributes = {}, fallbackFormat, ...props } = Astro.props;
	if (props.alt === void 0 || props.alt === null) throw new AstroError(ImageMissingAlt);
	const scopedStyleClass = props.class?.match(/\bastro-\w{8}\b/)?.[0];
	if (scopedStyleClass) {
		if (pictureAttributes.class) pictureAttributes.class = `${pictureAttributes.class} ${scopedStyleClass}`;
		else pictureAttributes.class = scopedStyleClass;
	}
	const layout = props.layout ?? imageConfig.layout ?? "none";
	const useResponsive = layout !== "none";
	if (useResponsive) {
		props.layout ??= layout;
		props.fit ??= imageConfig.objectFit ?? "cover";
		props.position ??= imageConfig.objectPosition ?? "center";
	} else if (imageConfig.objectFit || imageConfig.objectPosition) {
		if (imageConfig.objectFit) props.fit ??= imageConfig.objectFit;
		if (imageConfig.objectPosition) props.position ??= imageConfig.objectPosition;
	}
	for (const key in props) if (key.startsWith("data-astro-cid")) pictureAttributes[key] = props[key];
	const originalSrc = await resolveSrc(props.src);
	if ("inferSize" in props && props.inferSize && isRemoteImage(originalSrc)) {
		const remoteSize = await inferRemoteSize(originalSrc);
		delete props.inferSize;
		props.width ??= remoteSize.width;
		props.height ??= remoteSize.height;
	}
	const optimizedImages = await Promise.all(formats.map(async (format) => await getImage({
		...props,
		src: originalSrc,
		format,
		widths: props.widths,
		densities: props.densities
	})));
	let resultFallbackFormat = fallbackFormat ?? defaultFallbackFormat;
	if (!fallbackFormat && isESMImportedImage(originalSrc) && specialFormatsFallback.includes(originalSrc.format)) resultFallbackFormat = originalSrc.format;
	const fallbackImage = await getImage({
		...props,
		format: resultFallbackFormat,
		widths: props.widths,
		densities: props.densities
	});
	const imgAdditionalAttributes = {};
	const sourceAdditionalAttributes = {};
	if (props.sizes) sourceAdditionalAttributes.sizes = props.sizes;
	if (fallbackImage.srcSet.values.length > 0) imgAdditionalAttributes.srcset = fallbackImage.srcSet.attribute;
	const { class: className, ...attributes } = {
		...imgAdditionalAttributes,
		...fallbackImage.attributes
	};
	return renderTemplate`${maybeRenderHead($$result)}<picture${spreadAttributes(pictureAttributes)}>${Object.entries(optimizedImages).map(([_, image]) => {
		const hasExplicit1x = image.srcSet.values.some((srcSet) => srcSet.descriptor === "1x");
		const srcsetAttribute = props.densities && !hasExplicit1x || !props.densities && !props.widths && !useResponsive ? `${image.src}${image.srcSet.values.length > 0 ? ", " + image.srcSet.attribute : ""}` : image.srcSet.attribute;
		return renderTemplate`<source${addAttribute(srcsetAttribute, "srcset")}${addAttribute(mime.lookup(image.options.format ?? image.src) ?? `image/${image.options.format}`, "type")}${spreadAttributes(sourceAdditionalAttributes)}>`;
	})}<img${addAttribute(fallbackImage.src, "src")}${spreadAttributes(attributes)}${addAttribute(className, "class")}></picture>`;
}, "D:/PROJETOS/Alga Meet/node_modules/astro/components/Picture.astro", void 0);
// ../Alga Meet/node_modules/astro/components/Font.astro
createAstro("http://localhost:4599");
// ../Alga Meet/node_modules/astro/dist/assets/fonts/infra/remote-runtime-font-file-url-resolver.js
/**
* In development, font files are served through a Vite middleware.
* During prerendering, a temporary Node HTTP server is started to
* serve font files.
*
* When possible, the resolver uses a statically known server
* {@link address}. When the address is not yet available (e.g. the
* virtual module was evaluated before the HTTP server started
* listening — see #17722), the resolver falls back to deriving the
* origin from the caller-supplied {@link requestUrl}.
*/
var RemoteRuntimeFontFileUrlResolver = class {
	#urls;
	#address;
	constructor({ urls, address }) {
		this.#urls = urls;
		this.#address = address;
	}
	resolve(url, requestUrl) {
		if (!this.#urls.has(url)) return null;
		if (!url.startsWith("/")) {
			if (this.#address) url = new URL(url).pathname;
			else return url;
		}
		if (this.#address) return `http://${this.#address.family === "IPv6" ? `[${this.#address.address}]` : this.#address.address}:${this.#address.port}${url}`;
		if (requestUrl) return `${requestUrl.origin}${url}`;
		throw new Error("Server address unavailable, this should not happen. Open an issue.");
	}
};
new RemoteRuntimeFontFileUrlResolver({
	urls: /* @__PURE__ */ new Set([]),
	address: null
});
// \0astro:assets
var _astroLogger = createConsoleLogger({ level });
var _runtimeLogger = {
	info: (message) => _astroLogger.info(null, message),
	warn: (message) => _astroLogger.warn(null, message),
	error: (message) => _astroLogger.error(null, message)
};
var imageConfig = {
	"endpoint": { "route": "/_image" },
	"service": {
		"entrypoint": "astro/assets/services/sharp",
		"config": {}
	},
	"dangerouslyProcessSVG": false,
	"domains": [],
	"remotePatterns": [],
	"responsiveStyles": false
};
Object.defineProperties(imageConfig, {
	assetQueryParams: {
		value: void 0,
		enumerable: false,
		configurable: true
	},
	staticImageConfig: {
		value: {
			"base": "/",
			"assetsDir": "_astro"
		},
		enumerable: false,
		configurable: true
	}
});
var inferRemoteSize = async (url) => {
	return (await getConfiguredImageService()).getRemoteSize?.(url, imageConfig, _runtimeLogger) ?? inferRemoteSize$1(url, imageConfig);
};
var getImage = async (options) => await getImage$1(options, imageConfig, _runtimeLogger);
// apps/site/src/assets/media/hero.png
var hero_default = createImageAsset({
	"src": "/_astro/hero.CyuFpPqT.png",
	"width": 480,
	"height": 720,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/media/hero.png", true);
// apps/site/src/assets/shots/chat.png
var chat_default = createImageAsset({
	"src": "/_astro/chat.CmV_6Zts.png",
	"width": 1920,
	"height": 1080,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/shots/chat.png", true);
// apps/site/src/components/Hero.astro
var $$Hero = createComponent(async ($$result, $$props, $$slots) => {
	const img = await getImage({
		src: chat_default,
		format: "avif",
		widths: [
			960,
			1440,
			1920
		],
		sizes: "(min-width: 1240px) 1120px, 92vw"
	});
	const webp = await getImage({
		src: chat_default,
		format: "webp",
		widths: [
			960,
			1440,
			1920
		],
		sizes: "(min-width: 1240px) 1120px, 92vw"
	});
	const layers = [
		{
			id: "bar",
			r: [
				0,
				0,
				100,
				4.63
			],
			z: 300
		},
		{
			id: "rail",
			r: [
				0,
				4.63,
				4.17,
				95.37
			],
			z: 230
		},
		{
			id: "side",
			r: [
				4.17,
				4.63,
				16.14,
				95.37
			],
			z: 160
		},
		{
			id: "chat",
			r: [
				20.31,
				4.63,
				63.65,
				95.37
			],
			z: 0
		},
		{
			id: "side2",
			r: [
				83.96,
				4.63,
				16.04,
				95.37
			],
			z: 130
		}
	];
	const pops = [
		{
			id: "composer",
			r: [
				21.35,
				91.2,
				61.5,
				5.1
			],
			z: 90
		},
		{
			id: "invoice",
			r: [
				84.4,
				5.7,
				14.6,
				8.4
			],
			z: 250
		},
		{
			id: "me",
			r: [
				4.69,
				93.06,
				15.1,
				6
			],
			z: 220
		}
	];
	const tags = [
		{
			x: 12,
			y: 32,
			z: 160,
			t: "Canais de texto e de voz, do jeito que o grupo já usa"
		},
		{
			x: 40,
			y: 30,
			z: 0,
			t: "A conversa: respostas, reações, @menções"
		},
		{
			x: 91,
			y: 10,
			z: 250,
			t: "Quem está em voz aparece primeiro"
		},
		{
			x: 74,
			y: 93,
			z: 90,
			t: "Rascunho guardado por canal"
		}
	];
	const style = (r, z) => `--x:${r[0]}%;--y:${r[1]}%;--w:${r[2]}%;--h:${r[3]}%;--iw:${100 / r[2] * 100}%;--ix:${-r[0] / r[2] * 100}%;--iy:${-r[1] / r[3] * 100}%;--z:${z}px`;
	const title = ["Sua galera,", "de perto."];
	let n = 0;
	const lines = title.map((line) => line.split(" ").map((word) => [...word].map((ch) => ({
		ch,
		d: 120 + n++ * 34
	}))));
	return renderTemplate`${maybeRenderHead($$result)}<section class="hero" id="topo" data-hero aria-labelledby="hero-t" data-astro-cid-ge2uvauf><div class="stage" data-stage data-astro-cid-ge2uvauf><div class="backdrop" aria-hidden="true" data-astro-cid-ge2uvauf></div><div class="media hero-media" data-video="/media/hero.mp4" aria-hidden="true" data-astro-cid-ge2uvauf>${renderComponent($$result, "Picture", $$Picture, {
		"src": hero_default,
		"formats": ["avif", "webp"],
		"widths": [480],
		"sizes": "480px",
		"alt": "",
		"loading": "lazy",
		"fetchpriority": "low",
		"data-astro-cid-ge2uvauf": true
	})}</div><div class="copy wrap" data-copy data-astro-cid-ge2uvauf><p class="pill rise" style="--d:0ms" data-astro-cid-ge2uvauf><span class="live-dot" aria-hidden="true" data-astro-cid-ge2uvauf></span>Beta fechado · Windows 10 e 11</p><h1 id="hero-t" class="title" data-astro-cid-ge2uvauf><span class="sr-only" data-astro-cid-ge2uvauf>${title.join(" ")}</span><span aria-hidden="true" data-astro-cid-ge2uvauf>${lines.map((words) => renderTemplate`<span class="line" data-astro-cid-ge2uvauf>${words.map((word) => renderTemplate`<span class="word" data-astro-cid-ge2uvauf>${word.map((c) => renderTemplate`<span class="ch"${addAttribute(`animation-delay:${c.d}ms`, "style")} data-astro-cid-ge2uvauf>${c.ch}</span>`)}</span>`)}</span>`)}</span></h1><p class="lede rise" style="--d:620ms" data-astro-cid-ge2uvauf>Voz que soa como se todo mundo estivesse na mesma sala. Tela em 1080p de graça. Leve a ponto de o jogo nem perceber. E <strong data-astro-cid-ge2uvauf>nenhum anúncio</strong>, nunca.</p><div class="ctas rise" style="--d:760ms" data-astro-cid-ge2uvauf>${renderComponent($$result, "Download", $$Download, { "data-astro-cid-ge2uvauf": true })}<a class="btn btn-ghost btn-lg" href="#sala" data-astro-cid-ge2uvauf>Ouvir a sala</a></div><p class="dl-note rise" style="--d:860ms" data-astro-cid-ge2uvauf>${downloadNote}</p></div><p class="cue" data-cue aria-hidden="true" data-astro-cid-ge2uvauf><span data-astro-cid-ge2uvauf></span>Role para mergulhar</p><div class="scene" data-scene data-astro-cid-ge2uvauf><div class="tilt" data-tilt data-astro-cid-ge2uvauf><div class="win" data-win data-astro-cid-ge2uvauf><div class="slab" data-slab aria-hidden="true" data-astro-cid-ge2uvauf></div>${layers.map((l, i) => renderTemplate`<div${addAttribute(`layer l-${l.id}`, "class")} data-layer${addAttribute(l.z, "data-z")}${addAttribute(style(l.r, l.z), "style")} data-astro-cid-ge2uvauf><picture data-astro-cid-ge2uvauf><source type="image/avif"${addAttribute(img.srcSet.attribute, "srcset")} sizes="(min-width: 1240px) 1120px, 92vw" data-astro-cid-ge2uvauf><source type="image/webp"${addAttribute(webp.srcSet.attribute, "srcset")} sizes="(min-width: 1240px) 1120px, 92vw" data-astro-cid-ge2uvauf><img${addAttribute(webp.src, "src")} width="1920" height="1080" decoding="async"${addAttribute(i === 3 ? "eager" : "lazy", "loading")}${addAttribute(i === 3 ? "O Alga Meet aberto no espaço Estúdio Alga: canais à esquerda, a conversa em #geral no centro e, à direita, quem está em voz agora." : "", "alt")} data-astro-cid-ge2uvauf></picture></div>`)}${pops.map((p) => renderTemplate`<div${addAttribute(`layer pop p-${p.id}`, "class")} data-pop${addAttribute(p.z, "data-z")}${addAttribute(style(p.r, p.z), "style")} aria-hidden="true" data-astro-cid-ge2uvauf><picture data-astro-cid-ge2uvauf><source type="image/avif"${addAttribute(img.srcSet.attribute, "srcset")} sizes="(min-width: 1240px) 1120px, 92vw" data-astro-cid-ge2uvauf><source type="image/webp"${addAttribute(webp.srcSet.attribute, "srcset")} sizes="(min-width: 1240px) 1120px, 92vw" data-astro-cid-ge2uvauf><img${addAttribute(webp.src, "src")} width="1920" height="1080" decoding="async" loading="lazy" alt="" data-astro-cid-ge2uvauf></picture></div>`)}${tags.map((g) => renderTemplate`<span class="tag" data-tag${addAttribute(`--ax:${g.x}%;--ay:${g.y}%;--z:${g.z}px`, "style")} aria-hidden="true" data-astro-cid-ge2uvauf>${g.t}</span>`)}<div class="sheen" data-sheen aria-hidden="true" data-astro-cid-ge2uvauf></div><div class="flash" data-flash aria-hidden="true" data-astro-cid-ge2uvauf></div></div></div></div><p class="cap c1" data-cap="1" data-astro-cid-ge2uvauf>Tudo do grupo num lugar só.<br data-astro-cid-ge2uvauf><span data-astro-cid-ge2uvauf>Nada no caminho.</span></p><p class="cap c2" data-cap="2" data-astro-cid-ge2uvauf>Por dentro, <span data-astro-cid-ge2uvauf>o de sempre.</span><br data-astro-cid-ge2uvauf>Só que leve.</p></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Hero.astro", void 0);
// apps/site/src/data/facts.ts
var facts = {
	voiceLatencyMs: 46,
	packetsLost: 0,
	packetsSent: 20834,
	joinMs: 132,
	noiseSuppressionCostMs: 9,
	idleRamMb: 230,
	discordIdleRamMb: 808,
	discordProcesses: 6,
	voiceCpuPct: "1,7",
	streamCpuPct: "3,4",
	openMs: 575,
	installerMb: 109,
	freeStream: ["720p60", "1080p30"],
	plusStream: [
		"1080p60",
		"1440p60",
		"4K30"
	],
	discordFreeStream: "720p30",
	voiceKbps: 64,
	plusMonthly: "R$ 14,90",
	plusYearly: "R$ 149",
	attachFreeMb: 25,
	attachPlusMb: 100
};
// apps/site/src/data/conversation.ts
var people = [
	{
		name: "Ronaldo Barbosa",
		initials: "",
		grad: ["#f7c46c", "#e86885"],
		pitch: 142
	},
	{
		name: "Gabriel Airton",
		initials: "",
		grad: ["#7cc0f5", "#2f5ea8"],
		pitch: 128
	},
	{
		name: "Jovaci Neto",
		initials: "JN",
		grad: ["#3a2f2c", "#55443f"],
		pitch: 112
	},
	{
		name: "Alan Araújo",
		initials: "AA",
		grad: ["#2f2c3f", "#4a4466"],
		pitch: 120
	},
	{
		name: "Gleyson Mario",
		initials: "GM",
		grad: ["#8b8ef7", "#4b4fc0"],
		pitch: 155
	}
];
var lines = [
	{
		who: [0],
		at: .4,
		text: "Gente, entrei. Tão me ouvindo?"
	},
	{
		who: [1],
		at: 2.3,
		text: "Alto e claro. Parece que você tá aqui do lado."
	},
	{
		who: [2],
		at: 4.6,
		text: "Bora uma ranked antes da janta?"
	},
	{
		who: [3],
		at: 6.3,
		text: "Só se o Jovaci não for de suporte de novo."
	},
	{
		who: [2],
		at: 8.4,
		text: "Ei! Foi UMA vez."
	},
	{
		who: [
			0,
			1,
			3,
			4
		],
		at: 9.5,
		text: "kkkkkkkkk",
		laugh: true
	},
	{
		who: [4],
		at: 11.6,
		text: "Tô entrando. Me espera!"
	}
];
var seed = 20261101;
var rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
var syllables = [];
for (const l of lines) for (const who of l.who) {
	let t = l.at + (l.laugh ? rnd() * .25 : 0);
	if (l.laugh) {
		const n = 6 + Math.floor(rnd() * 4);
		for (let i = 0; i < n; i++) {
			const dur = .09 + rnd() * .05;
			syllables.push({
				who,
				at: t,
				dur,
				amp: .95 - i * .06,
				vowel: 0,
				bend: 1.15 - i * .03
			});
			t += dur + .05 + rnd() * .04;
		}
		continue;
	}
	for (const word of l.text.split(" ")) {
		const n = Math.max(1, Math.round(word.replace(/[^\p{L}]/gu, "").length / 2.6));
		for (let i = 0; i < n; i++) {
			const dur = .085 + rnd() * .09;
			const stress = word === word.toUpperCase() && word.length > 1 ? 1 : .55 + rnd() * .4;
			syllables.push({
				who,
				at: t,
				dur,
				amp: stress,
				vowel: Math.floor(rnd() * 5),
				bend: .92 + rnd() * .16 + (/[?]/.test(word) && i === n - 1 ? .2 : 0)
			});
			t += dur + .025 + rnd() * .04;
		}
		t += .07 + rnd() * .08;
	}
}
// apps/site/src/assets/media/room.png
var room_default = createImageAsset({
	"src": "/_astro/room.C-8p_8s3.png",
	"width": 960,
	"height": 540,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/media/room.png", true);
// apps/site/src/components/Voice.astro
var $$Voice = createComponent(($$result, $$props, $$slots) => {
	const dots = (w) => `background:linear-gradient(135deg,${people[w].grad[0]},${people[w].grad[1]})`;
	const lost = facts.packetsSent.toLocaleString("pt-BR");
	let seed = 7;
	const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
	const env = (x) => {
		const bursts = [
			[60, 150],
			[175, 260],
			[300, 330],
			[360, 470],
			[500, 545]
		];
		let a = 0;
		for (const [s, e] of bursts) if (x > s && x < e) a = Math.max(a, Math.sin((x - s) / (e - s) * Math.PI));
		return a;
	};
	const noise = Array.from({ length: 301 }, () => rnd() * 2 - 1);
	const line = (withNoise) => {
		let d = "";
		for (let i = 0; i <= 300; i++) {
			const x = i * 2;
			const y = 80 - env(x) * 58 * Math.sin(x * .42) * (.7 + .3 * Math.sin(x * .07)) - (withNoise ? noise[i] * 14 : 0);
			d += (i ? "L" : "M") + x + " " + y.toFixed(1);
		}
		return d;
	};
	const hiss = () => line(true);
	const speech = () => line(false);
	return renderTemplate`${maybeRenderHead($$result)}<section class="voice" id="voz" aria-labelledby="voz-t" data-astro-cid-d6druz62><!-- A sala: capítulo preso no nível A (WebGL); B/C mostram a mesma conversa parada. --><div class="room-ch" data-room-ch data-astro-cid-d6druz62><span class="anchor" id="sala" aria-hidden="true" data-astro-cid-d6druz62></span><div class="room-stage" data-room-stage data-astro-cid-d6druz62><div class="room-gl" data-room-gl aria-hidden="true" data-astro-cid-d6druz62></div><div class="room-head wrap" data-astro-cid-d6druz62><p class="eyebrow" data-astro-cid-d6druz62>A sala</p><h2 id="voz-t" class="chapter-t" data-astro-cid-d6druz62>Fala que a gente <em data-astro-cid-d6druz62>vê.</em></h2><p class="room-lede" data-astro-cid-d6druz62>Cada voz vira luz no chão. Role, e a conversa anda.</p></div><div class="names" aria-hidden="true" data-astro-cid-d6druz62>${people.map((p, i) => renderTemplate`<span class="name"${addAttribute(i, "data-name")} data-astro-cid-d6druz62>${p.name}</span>`)}</div><p class="caption" data-caption aria-hidden="true" data-astro-cid-d6druz62><b data-cap-who data-astro-cid-d6druz62></b><span data-cap-text data-astro-cid-d6druz62></span></p><button type="button" class="listen" data-listen aria-pressed="false" data-astro-cid-d6druz62><span class="eq" aria-hidden="true" data-astro-cid-d6druz62><i data-astro-cid-d6druz62></i><i data-astro-cid-d6druz62></i><i data-astro-cid-d6druz62></i><i data-astro-cid-d6druz62></i></span><span class="l-off" data-astro-cid-d6druz62>Ouvir a sala</span><span class="l-on" data-astro-cid-d6druz62>Silenciar</span></button><p class="latency" data-latency data-astro-cid-d6druz62><span class="tnum" data-astro-cid-d6druz62>${facts.voiceLatencyMs} ms</span> da boca de um ao ouvido do outro.</p><div class="media room-media wrap" data-video="/media/room.mp4" aria-hidden="true" data-astro-cid-d6druz62>${renderComponent($$result, "Picture", $$Picture, {
		"src": room_default,
		"formats": ["avif", "webp"],
		"widths": [960, 1280],
		"sizes": "(min-width: 1240px) 1160px, 100vw",
		"alt": "",
		"loading": "lazy",
		"data-astro-cid-d6druz62": true
	})}</div><ol class="transcript" aria-label="A conversa da sala" data-astro-cid-d6druz62>${lines.map((l) => renderTemplate`<li${addAttribute([l.laugh && "laugh"], "class:list")} data-astro-cid-d6druz62><span class="dots" aria-hidden="true" data-astro-cid-d6druz62>${l.who.map((w) => renderTemplate`<i${addAttribute(dots(w), "style")} data-astro-cid-d6druz62></i>`)}</span><b data-astro-cid-d6druz62>${l.laugh ? "Todo mundo" : people[l.who[0]].name}</b> <span data-astro-cid-d6druz62>${l.text}</span></li>`)}</ol></div></div><div class="wrap" data-astro-cid-d6druz62><p class="lit" data-reveal data-astro-cid-d6druz62>Quando alguém ri, você ouve a risada. <span data-astro-cid-d6druz62>Não um eco. Não um robô. Não meio segundo depois.</span></p><div class="grid" data-astro-cid-d6druz62><article class="stat big" data-reveal data-astro-cid-d6druz62><p class="num tnum" data-astro-cid-d6druz62><span${addAttribute(facts.voiceLatencyMs, "data-count")} data-astro-cid-d6druz62>${facts.voiceLatencyMs}</span><small data-astro-cid-d6druz62> ms</small></p><h3 data-astro-cid-d6druz62>da boca de um ao ouvido do outro</h3><p class="note" data-astro-cid-d6druz62>Passando pelo servidor de voz. Mediana em 10 minutos de chamada na rede local.</p></article><article class="stat" data-reveal style="--d:80ms" data-astro-cid-d6druz62><p class="num tnum" data-astro-cid-d6druz62><span${addAttribute(facts.packetsLost, "data-count")} data-astro-cid-d6druz62>${facts.packetsLost}</span><small data-astro-cid-d6druz62> de ${lost}</small></p><h3 data-astro-cid-d6druz62>pacotes de voz perdidos</h3><p class="note" data-astro-cid-d6druz62>No mesmo teste. Em rede ruim, a correção de perda (RED + FEC) segura a fala.</p></article><article class="stat" data-reveal style="--d:160ms" data-astro-cid-d6druz62><p class="num tnum" data-astro-cid-d6druz62><span${addAttribute(facts.joinMs, "data-count")} data-astro-cid-d6druz62>${facts.joinMs}</span><small data-astro-cid-d6druz62> ms</small></p><h3 data-astro-cid-d6druz62>do clique até estar na sala</h3><p class="note" data-astro-cid-d6druz62>Entrar num canal de voz é instantâneo de verdade.</p></article><article class="noise" data-noise data-reveal style="--d:80ms" data-astro-cid-d6druz62><div class="noise-copy" data-astro-cid-d6druz62><h3 data-astro-cid-d6druz62>O teclado fica do seu lado da tela.</h3><p data-astro-cid-d6druz62>Supressão de ruído no próprio PC tira ventilador, teclado e o cachorro do vizinho antes de a sua voz sair. Custa ${facts.noiseSuppressionCostMs} ms.</p><button type="button" class="toggle" aria-pressed="false" data-noise-toggle data-astro-cid-d6druz62><span class="knob" aria-hidden="true" data-astro-cid-d6druz62></span><span class="t-off" data-astro-cid-d6druz62>Supressão de ruído desligada</span><span class="t-on" data-astro-cid-d6druz62>Supressão de ruído ligada</span></button></div><svg class="wave" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true" data-astro-cid-d6druz62><defs data-astro-cid-d6druz62><linearGradient id="wg" x1="0" x2="1" data-astro-cid-d6druz62><stop offset="0" stop-color="#8b8ef7" stop-opacity="0" data-astro-cid-d6druz62></stop><stop offset=".15" stop-color="#8b8ef7" data-astro-cid-d6druz62></stop><stop offset=".85" stop-color="#8b8ef7" data-astro-cid-d6druz62></stop><stop offset="1" stop-color="#8b8ef7" stop-opacity="0" data-astro-cid-d6druz62></stop></linearGradient></defs><path class="hiss"${addAttribute(hiss(), "d")} data-astro-cid-d6druz62></path><path class="speech"${addAttribute(speech(), "d")} data-astro-cid-d6druz62></path></svg></article><article class="stat equal" data-reveal style="--d:160ms" data-astro-cid-d6druz62><p class="num" data-astro-cid-d6druz62><small data-astro-cid-d6druz62>Voz</small> igual</p><h3 data-astro-cid-d6druz62>para todo mundo</h3><p class="note" data-astro-cid-d6druz62>${facts.voiceKbps} kbps em Opus com correção de perda, no grátis e no pago. Ninguém paga para ser ouvido melhor.</p></article></div><p class="source" data-reveal data-astro-cid-d6druz62>Medido em 01/11/2026 em rede local, com duas instâncias do app e o nosso servidor de voz. Pela internet, some o caminho até o servidor (em São Paulo, no lançamento).</p></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Voice.astro", void 0);
// apps/site/src/assets/game/frame-1080.png
var frame_1080_default = createImageAsset({
	"src": "/_astro/frame-1080.ClC7WUYs.png",
	"width": 1920,
	"height": 1080,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/game/frame-1080.png", true);
// apps/site/src/assets/game/frame-720.png
var frame_720_default = createImageAsset({
	"src": "/_astro/frame-720.Brkjn5Y_.png",
	"width": 1280,
	"height": 720,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/game/frame-720.png", true);
// apps/site/src/components/Stream.astro
var $$Stream = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<section class="stream" id="tela" aria-labelledby="tela-t" data-astro-cid-ru23ufmz><div class="wrap head" data-astro-cid-ru23ufmz><p class="eyebrow" data-reveal data-astro-cid-ru23ufmz>Transmissão de tela</p><h2 id="tela-t" data-reveal data-astro-cid-ru23ufmz>Sua tela, <em data-astro-cid-ru23ufmz>nítida.</em></h2><p class="lede" data-reveal data-astro-cid-ru23ufmz>Passe a lente pela transmissão. Fora dela, <strong data-astro-cid-ru23ufmz>720p</strong>: o grátis de lá. Dentro, <strong data-astro-cid-ru23ufmz>1080p</strong>: o grátis daqui. A placa de vídeo codifica, então o jogo nem sente a live.</p></div><figure class="screen wrap" data-reveal data-astro-cid-ru23ufmz><div class="frame" data-lens-host style="--lx:30%;--ly:22%;--lr:140px" data-astro-cid-ru23ufmz><div class="still lo" aria-hidden="true" data-astro-cid-ru23ufmz>${renderComponent($$result, "Picture", $$Picture, {
		"src": frame_720_default,
		"formats": ["avif", "webp"],
		"widths": [1280],
		"sizes": "(min-width: 1260px) 1200px, 100vw",
		"alt": "",
		"loading": "lazy",
		"data-astro-cid-ru23ufmz": true
	})}</div><div class="still hi" data-astro-cid-ru23ufmz>${renderComponent($$result, "Picture", $$Picture, {
		"src": frame_1080_default,
		"formats": ["avif", "webp"],
		"widths": [1280, 1920],
		"sizes": "(min-width: 1260px) 1200px, 100vw",
		"alt": "Quadro de um jogo de corrida de planadores num canal entre prédios, na hora azul, com placar, minimapa e o chat do grupo. Dentro da lente, a imagem em 1080p; fora, em 720p.",
		"loading": "lazy",
		"data-astro-cid-ru23ufmz": true
	})}</div><div class="game" data-game aria-hidden="true" data-astro-cid-ru23ufmz></div><span class="live" aria-hidden="true" data-astro-cid-ru23ufmz><i data-astro-cid-ru23ufmz>AO VIVO</i> Alan Araújo</span><span class="out" aria-hidden="true" data-astro-cid-ru23ufmz><b data-astro-cid-ru23ufmz>${facts.discordFreeStream}</b> fora da lente · Discord grátis</span><span class="lens-tag" data-lens-tag aria-hidden="true" data-astro-cid-ru23ufmz><b data-astro-cid-ru23ufmz>1080p30</b> Alga Meet grátis</span></div><figcaption data-astro-cid-ru23ufmz>Simulação de resolução: o mesmo quadro, com 2/3 da resolução fora da lente (720 de 1080 linhas). O jogo é gerado aqui, ao vivo, no seu navegador; não mostra a diferença de quadros por segundo.</figcaption></figure><div class="wrap" data-astro-cid-ru23ufmz><div class="tiers" data-astro-cid-ru23ufmz><div class="tier" data-reveal data-astro-cid-ru23ufmz><p class="who" data-astro-cid-ru23ufmz>Grátis</p><ul data-astro-cid-ru23ufmz>${facts.freeStream.map((q) => renderTemplate`<li class="chip" data-astro-cid-ru23ufmz>${q}</li>`)}</ul><p class="note" data-astro-cid-ru23ufmz>Quem assiste nunca paga nada.</p></div><div class="tier plus" data-reveal style="--d:80ms" data-astro-cid-ru23ufmz><p class="who" data-astro-cid-ru23ufmz>Alga Plus</p><ul data-astro-cid-ru23ufmz>${facts.plusStream.map((q) => renderTemplate`<li class="chip" data-astro-cid-ru23ufmz>${q}</li>`)}</ul><p class="note" data-astro-cid-ru23ufmz>Para a noite de cinema e para quem mostra o jogo.</p></div><div class="tier cpu" data-reveal style="--d:160ms" data-astro-cid-ru23ufmz><p class="num tnum" data-astro-cid-ru23ufmz><span data-count="3.4" data-dec="1" data-astro-cid-ru23ufmz>${facts.streamCpuPct}</span><small data-astro-cid-ru23ufmz>% de CPU</small></p><p class="note" data-astro-cid-ru23ufmz>Transmitindo 1080p60 com encode por hardware (NVENC) num i5-13600KF. Placas AMD e Intel ainda em teste.</p></div></div></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Stream.astro", void 0);
// apps/site/src/assets/media/leve.png
var leve_default = createImageAsset({
	"src": "/_astro/leve.3LxAYExQ.png",
	"width": 600,
	"height": 600,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/media/leve.png", true);
// apps/site/src/components/Light.astro
var $$Light = createComponent(($$result, $$props, $$slots) => {
	const max = facts.discordIdleRamMb;
	return renderTemplate`${maybeRenderHead($$result)}<section class="light" id="leve" aria-labelledby="leve-t" data-astro-cid-bmokxcqa><!-- Nível A: capítulo preso; a esfera densa afunda e a bolha com a alga sobe (shader da água global). --><div class="float-ch" data-float-ch data-astro-cid-bmokxcqa><div class="float-stage" data-float-stage data-astro-cid-bmokxcqa><div class="wrap two" data-astro-cid-bmokxcqa><div class="copy" data-astro-cid-bmokxcqa><p class="eyebrow" data-reveal data-astro-cid-bmokxcqa>Leveza</p><h2 id="leve-t" data-reveal data-astro-cid-bmokxcqa>Leve como <em data-astro-cid-bmokxcqa>uma alga.</em></h2><p class="lede" data-reveal data-astro-cid-bmokxcqa>Parado na bandeja, esperando o pessoal chamar, o Discord ocupa <strong data-astro-cid-bmokxcqa>${facts.discordIdleRamMb} MB</strong> em ${facts.discordProcesses} processos. O Alga Meet, <strong data-astro-cid-bmokxcqa>${facts.idleRamMb}</strong>. O resto fica para o jogo.</p><ul class="minis" data-reveal data-astro-cid-bmokxcqa><li data-astro-cid-bmokxcqa><b class="tnum" data-astro-cid-bmokxcqa>${facts.voiceCpuPct}%</b><span data-astro-cid-bmokxcqa>de CPU numa chamada de voz</span></li><li data-astro-cid-bmokxcqa><b class="tnum" data-astro-cid-bmokxcqa>~${facts.openMs} ms</b><span data-astro-cid-bmokxcqa>do clique ao app aberto</span></li><li data-astro-cid-bmokxcqa><b class="tnum" data-astro-cid-bmokxcqa>0</b><span data-astro-cid-bmokxcqa>reinícios automáticos para "liberar memória"</span></li></ul><p class="area-note" data-astro-cid-bmokxcqa>Área de cada esfera proporcional à memória medida.</p></div><figure class="card" data-bars data-reveal data-astro-cid-bmokxcqa><p class="cap" data-astro-cid-bmokxcqa>Memória com o app parado na bandeja</p><div class="row" data-astro-cid-bmokxcqa><div class="label" data-astro-cid-bmokxcqa><span data-astro-cid-bmokxcqa>Alga Meet</span><b class="tnum" data-astro-cid-bmokxcqa>~<span${addAttribute(facts.idleRamMb, "data-count")} data-astro-cid-bmokxcqa>${facts.idleRamMb}</span> MB</b></div><div class="track" data-astro-cid-bmokxcqa><div class="fill us"${addAttribute(`--v:${facts.idleRamMb / max}`, "style")} data-astro-cid-bmokxcqa></div></div></div><div class="row" data-astro-cid-bmokxcqa><div class="label" data-astro-cid-bmokxcqa><span data-astro-cid-bmokxcqa>Discord <small data-astro-cid-bmokxcqa>${facts.discordProcesses} processos</small></span><b class="tnum" data-astro-cid-bmokxcqa>~<span${addAttribute(facts.discordIdleRamMb, "data-count")} data-astro-cid-bmokxcqa>${facts.discordIdleRamMb}</span> MB</b></div><div class="track" data-astro-cid-bmokxcqa><div class="fill them" style="--v:1" data-astro-cid-bmokxcqa></div></div></div><figcaption data-astro-cid-bmokxcqa>Memória privada medida em 01/11/2026 no mesmo PC (i5-13600KF, 32 GB, Windows 11). Discord 1.0.9266 na bandeja; Alga Meet ocioso por 10 minutos.</figcaption></figure></div><div class="media leve-media" data-video="/media/leve.mp4" data-once aria-hidden="true" data-astro-cid-bmokxcqa>${renderComponent($$result, "Picture", $$Picture, {
		"src": leve_default,
		"formats": ["avif", "webp"],
		"widths": [600],
		"sizes": "600px",
		"alt": "",
		"loading": "lazy",
		"data-astro-cid-bmokxcqa": true
	})}</div><p class="obj heavy" data-obj="a" aria-hidden="true" data-astro-cid-bmokxcqa><b class="tnum" data-astro-cid-bmokxcqa>${facts.discordIdleRamMb} MB</b>Discord · ${facts.discordProcesses} processos</p><p class="obj light-o" data-obj="b" aria-hidden="true" data-astro-cid-bmokxcqa><b class="tnum" data-astro-cid-bmokxcqa>${facts.idleRamMb} MB</b>Alga Meet</p></div></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Light.astro", void 0);
// apps/site/src/assets/shots/stage-crop.png
var stage_crop_default = createImageAsset({
	"src": "/_astro/stage-crop.B6ikCyaK.png",
	"width": 1510,
	"height": 760,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/shots/stage-crop.png", true);
// apps/site/src/components/Group.astro
var $$Group = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<section class="group" id="grupo" aria-labelledby="grupo-t" data-astro-cid-svhkl75q><div class="wrap" data-astro-cid-svhkl75q><div class="head" data-astro-cid-svhkl75q><p class="eyebrow" data-reveal data-astro-cid-svhkl75q>Para o seu grupo</p><h2 id="grupo-t" data-reveal data-astro-cid-svhkl75q>Feito para quem joga junto.</h2><p class="lede" data-reveal data-astro-cid-svhkl75q>Os canais de sempre, sem reaprender nada. A diferença é o que aparece primeiro: <strong data-astro-cid-svhkl75q>quem está aqui agora</strong>.</p></div><div class="bento" data-astro-cid-svhkl75q><article class="cell agora" data-reveal data-astro-cid-svhkl75q><div class="mock" aria-hidden="true" data-astro-cid-svhkl75q><p class="m-label" data-astro-cid-svhkl75q><svg width="12" height="12" viewBox="0 0 16 16" data-astro-cid-svhkl75q><rect x="3" y="5" width="2" height="6" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect><rect x="7" y="3" width="2" height="10" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect><rect x="11" y="5" width="2" height="6" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect></svg>Agora</p><div class="m-row" data-astro-cid-svhkl75q><span class="stack" data-astro-cid-svhkl75q><i class="av av-sky" data-astro-cid-svhkl75q></i><i class="av av-sun" data-astro-cid-svhkl75q></i><i class="av av-ink" data-astro-cid-svhkl75q>DA</i></span><span class="m-txt" data-astro-cid-svhkl75q><b data-astro-cid-svhkl75q>Sala de jogo</b><small data-astro-cid-svhkl75q>Noite de sexta · 3 em voz</small></span><span class="m-join" data-astro-cid-svhkl75q>Entrar</span></div><div class="m-row dim" data-astro-cid-svhkl75q><span class="stack" data-astro-cid-svhkl75q><i class="av av-plum" data-astro-cid-svhkl75q>EN</i></span><span class="m-txt" data-astro-cid-svhkl75q><b data-astro-cid-svhkl75q>Sala de foco</b><small data-astro-cid-svhkl75q>Estúdio · 1 em voz</small></span></div></div><h3 data-astro-cid-svhkl75q>Abriu o app, já sabe onde o pessoal está.</h3><p data-astro-cid-svhkl75q>"Agora" mostra quem está em voz e em qual sala. Um clique e você está junto.</p></article><article class="cell spaces" data-reveal style="--d:80ms" data-astro-cid-svhkl75q><div class="chan" aria-hidden="true" data-astro-cid-svhkl75q><p class="c-head" data-astro-cid-svhkl75q>Noite de sexta</p><p class="c-sec" data-astro-cid-svhkl75q>Texto</p><p class="c-row on" data-astro-cid-svhkl75q><span class="h" data-astro-cid-svhkl75q>#</span>geral</p><p class="c-row" data-astro-cid-svhkl75q><span class="h" data-astro-cid-svhkl75q>#</span>clipes</p><p class="c-sec" data-astro-cid-svhkl75q>Voz</p><p class="c-row" data-astro-cid-svhkl75q><span class="h v" data-astro-cid-svhkl75q><svg width="12" height="12" viewBox="0 0 16 16" data-astro-cid-svhkl75q><rect x="3" y="5" width="2" height="6" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect><rect x="7" y="3" width="2" height="10" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect><rect x="11" y="5" width="2" height="6" rx="1" fill="currentColor" data-astro-cid-svhkl75q></rect></svg></span>Sala de jogo<span class="c-n" data-astro-cid-svhkl75q>3</span></p><p class="c-row" data-astro-cid-svhkl75q><span class="h v" data-astro-cid-svhkl75q><svg width="12" height="12" viewBox="0 0 16 16" data-astro-cid-svhkl75q><path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" data-astro-cid-svhkl75q></path></svg></span>Resenha</p><span class="role" data-astro-cid-svhkl75q>@moderação</span></div><h3 data-astro-cid-svhkl75q>Espaços do jeito que o grupo já usa.</h3><p data-astro-cid-svhkl75q>Canais de texto e de voz, cargos, apelidos, convites com prazo e limite de usos.</p></article><article class="cell chat" data-reveal style="--d:120ms" data-astro-cid-svhkl75q><div class="bubbles" aria-hidden="true" data-astro-cid-svhkl75q><p class="b" data-astro-cid-svhkl75q><b data-astro-cid-svhkl75q>Gabriel</b> alguém topa uma ranked?</p><p class="b me" data-astro-cid-svhkl75q><b data-astro-cid-svhkl75q>Ronaldo</b> bora, entro em 2 min</p><p class="react" data-astro-cid-svhkl75q><span data-astro-cid-svhkl75q>👍 3</span><span data-astro-cid-svhkl75q>🔥 1</span></p></div><h3 data-astro-cid-svhkl75q>Chat que acompanha a call.</h3><p data-astro-cid-svhkl75q>Respostas, reações, @menções, anexos de até ${facts.attachFreeMb} MB e rascunho guardado por canal.</p></article><article class="cell stage" data-reveal style="--d:160ms" data-astro-cid-svhkl75q><div class="shot" data-parallax="4" data-astro-cid-svhkl75q>${renderComponent($$result, "Picture", $$Picture, {
		"src": stage_crop_default,
		"formats": ["avif", "webp"],
		"widths": [
			640,
			960,
			1280
		],
		"sizes": "(min-width: 1000px) 560px, calc(100vw - 64px)",
		"alt": "Palco de uma chamada de voz no Alga Meet: dois participantes, quem fala com o anel índigo.",
		"loading": "lazy",
		"data-astro-cid-svhkl75q": true
	})}</div><h3 data-astro-cid-svhkl75q>Quem fala, acende.</h3><p data-astro-cid-svhkl75q>Um anel índigo calmo segue a voz de cada um. Você sabe quem falou sem procurar.</p></article><article class="cell casa" data-reveal style="--d:200ms" data-astro-cid-svhkl75q><span class="soon" data-astro-cid-svhkl75q>Em breve</span><h3 data-astro-cid-svhkl75q>Casa: a vaquinha do grupo.</h3><p data-astro-cid-svhkl75q>Quem quiser apoia pelo Pix e o espaço de todo mundo fica mais bonito. Não mexe na voz de ninguém.</p></article></div></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Group.astro", void 0);
// apps/site/src/components/Trust.astro
var $$Trust = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<section class="trust" id="privacidade" aria-labelledby="priv-t" data-astro-cid-wtzqjce7><div class="wrap" data-astro-cid-wtzqjce7><div class="head" data-astro-cid-wtzqjce7><p class="eyebrow" data-reveal data-astro-cid-wtzqjce7>Privacidade</p><h2 id="priv-t" data-reveal data-astro-cid-wtzqjce7>Sem anúncio. Sem vender você.</h2><p class="lede" data-reveal data-astro-cid-wtzqjce7>O seu grupo não é produto. Está tudo escrito aqui, inclusive o que ainda não fazemos.</p></div><ul class="list" data-astro-cid-wtzqjce7>${[
		{
			t: "Zero anúncio.",
			p: "Nem banner, nem missão patrocinada, nem moeda para assistir propaganda. A conta fecha com o Alga Plus e itens de personalização.",
			i: "M4 12h16M12 4v16",
			x: true
		},
		{
			t: "Seus dados não estão à venda.",
			p: "Nem para anunciante, nem para ninguém. O que o app guarda serve para ele funcionar, e você baixa uma cópia quando quiser.",
			i: "M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3"
		},
		{
			t: "Chamadas no privado: ponta a ponta.",
			p: "Voz e tela nas conversas privadas são cifradas com MLS (RFC 9420). A chave fica nos aparelhos de quem está na chamada.",
			i: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"
		},
		{
			t: "Nos espaços, vira opção.",
			p: "A ponta a ponta nas salas de voz já funciona por espaço. O interruptor nas configurações chega numa próxima versão do beta.",
			i: "M4 7h10M4 17h6M18 7h2M14 17h6M14 5v4M10 15v4"
		},
		{
			t: "Idade sem selfie.",
			p: "Pedimos só a data de nascimento. Nada de foto do rosto nem de documento.",
			i: "M4 6h16v13H4zM4 10h16M9 3v4M15 3v4"
		},
		{
			t: "Relatório de qualidade vem desligado.",
			p: "Se quiser ajudar a melhorar as chamadas, você liga. Até lá, nada é enviado.",
			i: "M3 12h4l3-7 4 14 3-7h4"
		}
	].map((it, n) => renderTemplate`<li data-reveal${addAttribute(`--d:${n % 3 * 70}ms`, "style")} data-astro-cid-wtzqjce7><svg class="ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" data-astro-cid-wtzqjce7><path${addAttribute(it.i, "d")} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${addAttribute(it.x ? "rotate(45 12 12)" : void 0, "transform")} data-astro-cid-wtzqjce7></path></svg><h3 data-astro-cid-wtzqjce7>${it.t}</h3><p data-astro-cid-wtzqjce7>${it.p}</p></li>`)}</ul><aside class="honest" data-reveal data-astro-cid-wtzqjce7><h3 data-astro-cid-wtzqjce7>O que ainda não é ponta a ponta</h3><p data-astro-cid-wtzqjce7>Mensagens de texto e chamadas em espaços com a opção desligada são cifradas no caminho até o servidor (TLS e DTLS-SRTP), não de ponta a ponta. A gente prefere que você saiba por aqui.</p></aside></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Trust.astro", void 0);
// apps/site/src/components/Plus.astro
var $$Plus = createComponent(($$result, $$props, $$slots) => {
	const free = [
		"Voz igual para todos, sem limite de tempo",
		`Tela em ${facts.freeStream.join(" e ")}`,
		"Espaços, canais, cargos e convites",
		`Anexos de até ${facts.attachFreeMb} MB`,
		"Sem anúncio, sem prazo, sem cartão"
	];
	const plus = [
		`Tela em ${facts.plusStream.join(", ").replace(/, ([^,]*)$/, " e $1")}`,
		`Anexos de até ${facts.attachPlusMb} MB`,
		"Guarda-roupa que ganha um item novo por mês",
		"Aura de voz, ícones do app e banner animado",
		"Dois passes de 7 dias por mês para dar a amigos"
	];
	return renderTemplate`${maybeRenderHead($$result)}<section class="plus" id="plus" aria-labelledby="plus-t" data-astro-cid-skg4pmoi><div class="wrap" data-astro-cid-skg4pmoi><div class="head" data-astro-cid-skg4pmoi><p class="eyebrow" data-reveal data-astro-cid-skg4pmoi>Planos</p><h2 id="plus-t" data-reveal data-astro-cid-skg4pmoi>O grátis é bom de verdade.</h2><p class="lede" data-reveal data-astro-cid-skg4pmoi>Tudo que o grupo precisa para conversar, de graça. O Alga Plus é para quem transmite muito e para quem quer apoiar.</p></div><div class="plans" data-astro-cid-skg4pmoi><article class="plan" data-reveal data-astro-cid-skg4pmoi><h3 data-astro-cid-skg4pmoi>Grátis</h3><p class="price" data-astro-cid-skg4pmoi><b data-astro-cid-skg4pmoi>R$ 0</b></p><ul data-astro-cid-skg4pmoi>${free.map((f) => renderTemplate`<li data-astro-cid-skg4pmoi>${f}</li>`)}</ul></article><article class="plan pro" data-reveal style="--d:80ms" data-astro-cid-skg4pmoi><h3 data-astro-cid-skg4pmoi>Alga Plus</h3><p class="price" data-astro-cid-skg4pmoi><b class="tnum" data-astro-cid-skg4pmoi>${facts.plusMonthly}</b><span data-astro-cid-skg4pmoi>/mês</span><small data-astro-cid-skg4pmoi>ou ${facts.plusYearly} por ano</small></p><ul data-astro-cid-skg4pmoi>${plus.map((f) => renderTemplate`<li data-astro-cid-skg4pmoi>${f}</li>`)}</ul><p class="fine" data-astro-cid-skg4pmoi>Cancele quando quiser. Reembolso em até 7 dias. Preço e benefícios em validação durante o beta.</p></article></div><article class="hora" data-reveal aria-labelledby="hora-t" data-astro-cid-skg4pmoi><div class="sky" aria-hidden="true" data-astro-cid-skg4pmoi><div class="sun" data-astro-cid-skg4pmoi></div><div class="city" data-astro-cid-skg4pmoi>${Array.from({ length: 22 }, (_, i) => renderTemplate`<i${addAttribute(`--h:${28 + i * 37 % 54}%;--w:${3 + i * 7 % 3}%;--l:${i * 41 % 100}%;--i:${i}`, "style")} data-astro-cid-skg4pmoi></i>`)}</div></div><div class="hora-copy" data-astro-cid-skg4pmoi><p class="eyebrow" data-astro-cid-skg4pmoi>Coleção 01 · em breve</p><h3 id="hora-t" data-astro-cid-skg4pmoi>Hora Azul</h3><p data-astro-cid-skg4pmoi>O quarto de hora depois do pôr do sol, quando o céu fica índigo e as janelas acendem. É a hora em que o grupo entra na call.</p><p class="rules" data-astro-cid-skg4pmoi>Nada aleatório. Nada de contagem regressiva. O que você vê é o que você leva.</p></div></article></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Plus.astro", void 0);
// apps/site/src/components/Faq.astro
var $$Faq = createComponent(($$result, $$props, $$slots) => {
	const qa = [
		["É grátis mesmo?", `É. Voz, chat, espaços e tela em ${facts.freeStream.join(" e ")} não custam nada e não têm prazo. O Alga Plus existe para quem quer transmitir em qualidade mais alta e para quem quer apoiar o projeto.`],
		["Funciona no Mac ou no celular?", "Por enquanto, só no Windows 10 e 11. Começamos pelo PC porque é onde o grupo joga. Outras plataformas vêm depois, sem data prometida."],
		["Por que está em beta fechado?", "Porque estamos acompanhando cada grupo de perto enquanto o servidor de voz cresce. Se alguém te mandou este site, peça o convite para essa pessoa."],
		["O meu grupo está no Discord. Muda muito?", "Quase nada no jeito de usar: espaços, canais de texto e de voz, cargos e convites funcionam como vocês já conhecem. Muda o que fica em volta: mais leve, tela melhor de graça, nenhum anúncio."],
		["Pesa no jogo?", `Na bandeja, cerca de ${facts.idleRamMb} MB de memória. Numa chamada de voz, ${facts.voiceCpuPct}% de CPU. Transmitindo 1080p60, ${facts.streamCpuPct}% de CPU, porque quem codifica é a placa de vídeo.`],
		["É seguro?", "Chamadas no privado são cifradas de ponta a ponta. O resto é cifrado no caminho até o servidor. Senhas guardadas com argon2id, nenhuma captura de tela sem você escolher o que mostrar. Detalhes na seção de privacidade."],
		["Como vocês ganham dinheiro?", "Com o Alga Plus e com itens de personalização comprados uma vez. Sem anúncio, sem venda de dados, sem caixa-surpresa."],
		["Tem idade mínima?", "Tem: 16 anos. Para quem tem 16 ou 17, a conta já vem com proteções (mensagem direta só entre amigos e compras desligadas)."]
	];
	return renderTemplate`${maybeRenderHead($$result)}<section class="faq" id="faq" aria-labelledby="faq-t" data-astro-cid-hemr5th4><div class="wrap two" data-astro-cid-hemr5th4><div class="head" data-astro-cid-hemr5th4><p class="eyebrow" data-reveal data-astro-cid-hemr5th4>Perguntas</p><h2 id="faq-t" data-reveal data-astro-cid-hemr5th4>Antes de chamar o pessoal.</h2></div><div class="list" data-reveal data-astro-cid-hemr5th4>${qa.map(([q, a], i) => renderTemplate`<details name="faq"${addAttribute(i === 0, "open")} data-astro-cid-hemr5th4><summary data-astro-cid-hemr5th4>${q}<span class="pm" aria-hidden="true" data-astro-cid-hemr5th4></span></summary><p data-astro-cid-hemr5th4>${a}</p></details>`)}</div></div></section>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Faq.astro", void 0);
// apps/site/src/assets/brand/mark.svg?url
var mark_default = "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='75%2024%20105.2%20208.2'%3e%3cpath%20d='M106%2024C113%2024%20118%2031%20121%2040C127%2058%20129%2084%20126%20108C123%20132%20117%20150%20117%20176C117%20198%20121%20214%20123%20222C125%20229%20122%20233%20117%20232C108%20230%2098%20222%2091%20210C80%20192%2075%20168%2075%20142C75%20108%2084%2078%2094%2050C97.5%2040.2%2099%2024%20106%2024Z'%20fill='%23f7f8f8'/%3e%3cpath%20d='M160%2078C166%2078%20169.6%2085.6%20172%2092C178%20108%20181%20124%20180%20142C179%20166%20171%20186%20158%20202C150%20212%20144%20220%20140%20225C137%20229%20132%20228%20132%20223C131%20204%20133%20172%20137%20150C141%20126%20146%20104%20151%2090C153.3%2083.6%20155%2078%20160%2078Z'%20fill='%238b8ef7'/%3e%3c/svg%3e";
// apps/site/src/assets/media/final.png
var final_default = createImageAsset({
	"src": "/_astro/final.CmcDf_Ss.png",
	"width": 960,
	"height": 600,
	"format": "png"
}, "D:/PROJETOS/alga-presence/apps/site/src/assets/media/final.png", true);
// apps/site/src/components/Final.astro
var $$Final = createComponent(($$result, $$props, $$slots) => {
	const year = (/* @__PURE__ */ new Date()).getFullYear();
	return renderTemplate`${maybeRenderHead($$result)}<section class="final" aria-labelledby="final-t" data-final data-astro-cid-ufsn2at3><div class="final-stage" data-final-stage data-astro-cid-ufsn2at3><div class="horizon" data-horizon aria-hidden="true" data-astro-cid-ufsn2at3></div><div class="media final-media" data-video="/media/final.mp4" data-once aria-hidden="true" data-astro-cid-ufsn2at3>${renderComponent($$result, "Picture", $$Picture, {
		"src": final_default,
		"formats": ["avif", "webp"],
		"widths": [960, 1440],
		"sizes": "100vw",
		"alt": "",
		"loading": "lazy",
		"data-astro-cid-ufsn2at3": true
	})}</div><div class="wrap inner" data-astro-cid-ufsn2at3><img class="mark"${addAttribute(mark_default, "src")} width="72" height="72" alt="" data-reveal data-astro-cid-ufsn2at3><span class="mark-space" aria-hidden="true" data-astro-cid-ufsn2at3></span><h2 id="final-t" data-final-t data-astro-cid-ufsn2at3>Chama o <em data-astro-cid-ufsn2at3>pessoal.</em></h2><p class="lede" data-final-in data-astro-cid-ufsn2at3>Baixe, crie um espaço e mande o convite. Em dois minutos vocês estão conversando.</p><div class="cta" data-final-in data-astro-cid-ufsn2at3>${renderComponent($$result, "Download", $$Download, { "data-astro-cid-ufsn2at3": true })}</div><p class="specs" data-final-in data-astro-cid-ufsn2at3>${downloadNote} · instalador de ${facts.installerMb} MB · <a${addAttribute(releasesUrl, "href")} rel="noopener" data-astro-cid-ufsn2at3>ver novidades</a></p></div></div></section><footer class="foot" data-astro-cid-ufsn2at3><div class="wrap row" data-astro-cid-ufsn2at3>${renderComponent($$result, "Logo", $$Logo, {
		"height": 22,
		"data-astro-cid-ufsn2at3": true
	})}<p data-astro-cid-ufsn2at3>Feito no Brasil, para conversar de perto. © ${year} Alga Meet.</p></div></footer>`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/Final.astro", void 0);
// apps/site/src/components/InviteDialog.astro
var $$InviteDialog = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${false}`;
}, "D:/PROJETOS/alga-presence/apps/site/src/components/InviteDialog.astro", void 0);
// apps/site/src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
var $$Index = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"title": "Alga Meet · A voz dos seus amigos, de perto",
		"description": "Canais de voz que soam de perto, tela em 1080p de graça e chat para o seu grupo. Leve enquanto você joga e sem anúncio nenhum. Para Windows."
	}, { "default": ($$result) => renderTemplate`${renderComponent($$result, "Nav", $$Nav, {})}${maybeRenderHead($$result)}<main id="conteudo">${renderComponent($$result, "Hero", $$Hero, {})}${renderComponent($$result, "Voice", $$Voice, {})}${renderComponent($$result, "Stream", $$Stream, {})}${renderComponent($$result, "Light", $$Light, {})}${renderComponent($$result, "Group", $$Group, {})}${renderComponent($$result, "Trust", $$Trust, {})}${renderComponent($$result, "Plus", $$Plus, {})}${renderComponent($$result, "Faq", $$Faq, {})}</main>${renderComponent($$result, "Final", $$Final, {})}${renderComponent($$result, "InviteDialog", $$InviteDialog, {})}` })}${renderScript($$result, "D:/PROJETOS/alga-presence/apps/site/src/pages/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "D:/PROJETOS/alga-presence/apps/site/src/pages/index.astro", void 0);
var $$file = "D:/PROJETOS/alga-presence/apps/site/src/pages/index.astro";
// \0virtual:astro:page:src/pages/index@_@astro
var index___astro_exports = /* @__PURE__ */ __exportAll({ page: () => page });
var page = () => pages_exports;
export { resolveDefaultOutputFormat as a, detector as i, baseService as n, page, parseQuality as r, index___astro_exports as t };
