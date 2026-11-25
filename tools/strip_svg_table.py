#!/usr/bin/env python3
"""Remove the `SVG ` table from a Noto Color Emoji font file.

Google publishes Noto Color Emoji with two sets of colour glyphs in one file: COLRv1 and
OpenType-SVG. Chrome draws the COLRv1 glyphs and never reads the SVG table, which makes up
about 80% of the file. This script writes a copy without that table. Every other table is
copied byte for byte; only the table directory and the checksums are rebuilt.

Usage:
    python3 tools/strip_svg_table.py <NotoColorEmoji-Regular.ttf> extension/fonts/NotoColorEmoji.ttf

Needs only the Python 3 standard library. Input and output may be the same path.
"""
import struct
import sys

SVG_TAG = b"SVG "
HEAD_TAG = b"head"
CHECKSUM_MAGIC = 0xB1B0AFBA


def read_tables(data):
    """Return the sfnt version tag and a {tag: bytes} dict of the font's tables."""
    count = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for index in range(count):
        tag, _checksum, offset, length = struct.unpack(">4sIII", data[12 + index * 16: 28 + index * 16])
        tables[tag] = data[offset: offset + length]
    return data[0:4], tables


def checksum(blob):
    padded = blob + b"\0" * ((4 - len(blob) % 4) % 4)
    return sum(struct.unpack(">%dI" % (len(padded) // 4), padded)) & 0xFFFFFFFF


def without_adjustment(head):
    """The head table with checkSumAdjustment zeroed, as the checksum rules require."""
    return head[:8] + b"\0\0\0\0" + head[12:]


def build(version, tables):
    tags = sorted(tables)
    count = len(tags)
    entry_selector = count.bit_length() - 1
    search_range = (1 << entry_selector) * 16
    header = struct.pack(">4sHHHH", version, count, search_range, entry_selector, count * 16 - search_range)

    offset = 12 + count * 16
    records = b""
    body = b""
    head_offset = None
    for tag in tags:
        blob = without_adjustment(tables[tag]) if tag == HEAD_TAG else tables[tag]
        if tag == HEAD_TAG:
            head_offset = offset
        padding = (4 - len(blob) % 4) % 4
        records += struct.pack(">4sIII", tag, checksum(blob), offset, len(blob))
        body += blob + b"\0" * padding
        offset += len(blob) + padding

    font = bytearray(header + records + body)
    adjustment = (CHECKSUM_MAGIC - checksum(bytes(font))) & 0xFFFFFFFF
    font[head_offset + 8: head_offset + 12] = struct.pack(">I", adjustment)
    return bytes(font)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source_path, output_path = sys.argv[1], sys.argv[2]

    with open(source_path, "rb") as handle:
        source = handle.read()
    version, tables = read_tables(source)

    if SVG_TAG not in tables:
        sys.exit("%s has no SVG table; nothing to remove." % source_path)
    if b"COLR" not in tables:
        sys.exit("%s has no COLR table; without the SVG table it would have no colour glyphs." % source_path)

    kept = {tag: blob for tag, blob in tables.items() if tag != SVG_TAG}
    output = build(version, kept)

    # Read the result back and make sure nothing but the SVG table and the checksum changed.
    _, written = read_tables(output)
    assert sorted(written) == sorted(kept), "table list changed"
    for tag, blob in kept.items():
        original = without_adjustment(blob) if tag == HEAD_TAG else blob
        result = without_adjustment(written[tag]) if tag == HEAD_TAG else written[tag]
        assert original == result, "table %r changed" % tag
    assert checksum(output) == CHECKSUM_MAGIC, "whole-file checksum is wrong"

    with open(output_path, "wb") as handle:
        handle.write(output)

    megabytes = 1000 * 1000
    print("removed SVG table: %.1f MB" % (len(tables[SVG_TAG]) / megabytes))
    print("%s: %.1f MB -> %s: %.1f MB (%d tables, all others unchanged)" % (
        source_path, len(source) / megabytes, output_path, len(output) / megabytes, len(kept)))


if __name__ == "__main__":
    main()
