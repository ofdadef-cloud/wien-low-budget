"""
data_parser.py – Liest und schreibt die LOCATIONS aus data.js
Verwendet einen zeilenbasierten Ansatz, der robust gegenüber Whitespace-Unterschieden ist.
"""

def read_data_js(file_path):
    """
    Liest data.js und extrahiert den Inhalt des LOCATIONS-Arrays.
    Gibt zurück: (locations_string, start_line_index, end_line_index)
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    start_line = None
    end_line = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == 'const LOCATIONS = [' and start_line is None:
            start_line = i + 1  # Content starts on the NEXT line
        if start_line is not None and stripped == 'const VIDEO_GUIDES = [':
            end_line = i - 1  # Content ends on the line BEFORE this one (which is '];')
            break

    if start_line is None:
        raise ValueError("Could not find 'const LOCATIONS = [' in data.js")
    if end_line is None:
        raise ValueError("Could not find 'const VIDEO_GUIDES = [' in data.js")

    locations_content = "".join(lines[start_line:end_line])
    
    print(f"  -> Found LOCATIONS block: lines {start_line+1} to {end_line+1}")
    return locations_content, start_line, end_line, lines

def save_data_js(file_path, new_locations_content, start_line, end_line, original_lines):
    """
    Schreibt die neue LOCATIONS-Inhalt zurück in data.js.
    """
    # Split new content into lines
    new_lines = new_locations_content.splitlines(keepends=True)
    if not new_lines[-1].endswith('\n'):
        new_lines[-1] += '\n'

    updated_lines = original_lines[:start_line] + new_lines + original_lines[end_line:]

    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(updated_lines)

    print("  -> Successfully updated data.js!")
