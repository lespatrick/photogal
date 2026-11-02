-- photogal Companion Export Script for Capture One Pro
-- Automates export of selected variants and uploads them directly to photogal

property defaultServerURL : "http://localhost:3000"
property defaultAPIToken : ""

tell application "Capture One"
	activate
	set selVariants to selected variants
	if (count of selVariants) is 0 then
		display alert "No Photos Selected" message "Please select one or more image variants in Capture One to export to photogal." as critical
		return
	end if
	set variantCount to count of selVariants
end tell

-- Prompt for Server URL & API Token
set serverPrompt to display dialog "Enter photogal Server URL:" default answer defaultServerURL buttons {"Cancel", "Continue"} default button "Continue" with title "photogal Export"
set targetServer to text returned of serverPrompt

set tokenPrompt to display dialog "Enter API Token (pg_live_...):" default answer defaultAPIToken buttons {"Cancel", "Export & Upload"} default button "Export & Upload" with hidden answer with title "photogal Authentication"
set targetToken to text returned of tokenPrompt

-- Fetch Galleries
set fetchCmd to "curl -s -H \"Authorization: Bearer " & targetToken & "\" \"" & targetServer & "/api/admin/galleries\""
set galleriesJSON to do shell script fetchCmd

if galleriesJSON contains "Brak autoryzacji" or galleriesJSON contains "Unauthorized" then
	display alert "Authentication Error" message "Invalid API Token or Server URL. Please check your token in photogal Admin settings." as critical
	return
end if

-- Ask for Gallery Title or ID
set galleryPrompt to display dialog "Exporting " & variantCount & " photos.\n\nEnter Target Gallery ID (leave empty to create a new gallery):" default answer "" buttons {"Cancel", "Proceed"} default button "Proceed" with title "Target Gallery"
set chosenGallery to text returned of galleryPrompt

if chosenGallery is "" then
	set newTitlePrompt to display dialog "Enter New Gallery Title:" default answer "Capture One Export" buttons {"Cancel", "Create & Export"} default button "Create & Export" with title "New Gallery"
	set newTitle to text returned of newTitlePrompt
	
	set curDate to do shell script "date '+%Y-%m-%d'"
	set createPayload to "{\"title\":\"" & newTitle & "\",\"shoot_date\":\"" & curDate & "\"}"
	set createCmd to "curl -s -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer " & targetToken & "\" -d '" & createPayload & "' \"" & targetServer & "/api/admin/galleries\""
	set createResponse to do shell script createCmd
	
	-- Extract gallery id using python helper
	set parseCmd to "python3 -c 'import json, sys; d=json.loads(sys.argv[1]); print(d.get(\"gallery\", {}).get(\"id\", \"\"))' " & quoted form of createResponse
	set chosenGallery to do shell script parseCmd
	if chosenGallery is "" then
		display alert "Failed to Create Gallery" message "Server response: " & createResponse as critical
		return
	end if
end if

-- Create temporary export folder
set tempExportDir to (do shell script "mktemp -d /tmp/photogal_export.XXXXXX")

-- Trigger Capture One export
tell application "Capture One"
	try
		-- Find or use standard JPEG recipe
		set targetRecipe to first recipe whose name contains "JPEG" or name contains "Web" or name contains "Export"
	on error
		set targetRecipe to current recipe
	end try
	
	-- Process selected variants
	process selVariants recipe targetRecipe
end tell

-- Upload exported files using curl
set uploadCmd to "find \"" & tempExportDir & "\" -type f \\( -name \"*.jpg\" -o -name \"*.jpeg\" -o -name \"*.JPG\" \\) -exec curl -s -X POST -H \"Authorization: Bearer " & targetToken & "\" -F \"files=@{}\" \"" & targetServer & "/api/admin/galleries/" & chosenGallery & "/upload\" \\;"
do shell script uploadCmd

-- Clean up
do shell script "rm -rf \"" & tempExportDir & "\""

-- Open gallery in default browser
open location (targetServer & "/admin/galleries/" & chosenGallery)

display notification "Uploaded " & variantCount & " photos to photogal." with title "photogal Export Complete"

