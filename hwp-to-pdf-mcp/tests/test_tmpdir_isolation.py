#!/usr/bin/env python3
"""
Test to verify that hwp2pdf_cli and server.py NEVER delete or alter
any files in the user's system $TMPDIR.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLI_BINARY = PROJECT_ROOT / "bin" / "hwp2pdf_cli"
TESTS_DIR = PROJECT_ROOT / "tests"
SAMPLE_HWP = TESTS_DIR / "sample_korean.hwp"
SAMPLE_HWPX = TESTS_DIR / "sample_report.hwpx"


def main() -> None:
    system_tmp = Path(tempfile.gettempdir())
    print(f"System $TMPDIR is: {system_tmp}")

    # 1. Create a sentinel file in system $TMPDIR
    sentinel_file = system_tmp / "hwp2pdf_safety_sentinel_do_not_delete.txt"
    sentinel_content = "This user file must never be deleted by Hancom engine!\n"
    sentinel_file.write_text(sentinel_content, encoding="utf-8")
    assert sentinel_file.exists(), "Failed to create sentinel file in $TMPDIR"

    # Also create a dummy subdirectory in system $TMPDIR
    sentinel_dir = system_tmp / "hwp2pdf_safety_sentinel_dir"
    sentinel_dir.mkdir(exist_ok=True)
    (sentinel_dir / "child.txt").write_text("child content", encoding="utf-8")

    try:
        # 2. Test direct CLI invocation
        out_pdf1 = TESTS_DIR / "tmp_test1.pdf"
        if out_pdf1.exists():
            out_pdf1.unlink()

        print("[Test 1] Running direct hwp2pdf_cli on .hwp...")
        proc1 = subprocess.run(
            [str(CLI_BINARY), "--input", str(SAMPLE_HWP), "--output", str(out_pdf1)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc1.returncode == 0, f"CLI failed: {proc1.stderr}"
        assert out_pdf1.exists()

        # Check sentinel immediately after direct CLI
        assert sentinel_file.exists(), "CRITICAL: sentinel file was deleted by hwp2pdf_cli!"
        assert sentinel_dir.exists(), "CRITICAL: sentinel dir was deleted by hwp2pdf_cli!"
        assert (sentinel_dir / "child.txt").exists()
        print("  -> Sentinel file in $TMPDIR is SAFE and intact!")

        # 3. Test direct CLI invocation on .hwpx
        out_pdf2 = TESTS_DIR / "tmp_test2.pdf"
        if out_pdf2.exists():
            out_pdf2.unlink()

        print("[Test 2] Running direct hwp2pdf_cli on .hwpx...")
        proc2 = subprocess.run(
            [str(CLI_BINARY), "--input", str(SAMPLE_HWPX), "--output", str(out_pdf2)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc2.returncode == 0, f"CLI failed: {proc2.stderr}"
        assert out_pdf2.exists()

        # Check sentinel again
        assert sentinel_file.exists(), "CRITICAL: sentinel file was deleted by hwp2pdf_cli (.hwpx)!"
        assert (sentinel_dir / "child.txt").exists()
        print("  -> Sentinel file in $TMPDIR is SAFE and intact!")

        # 4. Test MCP server test suite
        print("[Test 3] Running full MCP server test suite...")
        proc_mcp = subprocess.run(
            [sys.executable, str(TESTS_DIR / "test_mcp_server.py")],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc_mcp.returncode == 0, f"MCP test failed: {proc_mcp.stderr}"

        # Final check on sentinel
        assert sentinel_file.exists(), "CRITICAL: sentinel file was deleted by MCP server suite!"
        assert sentinel_file.read_text(encoding="utf-8") == sentinel_content
        assert (sentinel_dir / "child.txt").exists()
        print("  -> All sentinel files and folders in $TMPDIR are 100% PRESERVED!")

        print("\n[SUCCESS] Temp directory safety verification passed completely!")

    finally:
        if sentinel_file.exists():
            sentinel_file.unlink()
        if (sentinel_dir / "child.txt").exists():
            (sentinel_dir / "child.txt").unlink()
        if sentinel_dir.exists():
            sentinel_dir.rmdir()
        if out_pdf1.exists():
            out_pdf1.unlink()
        if out_pdf2.exists():
            out_pdf2.unlink()


if __name__ == "__main__":
    main()
