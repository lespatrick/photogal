CC = clang
CO_FRAMEWORKS = /Applications/Capture One.app/Contents/Frameworks
CO_APP = /Applications/Capture One.app/Contents
PLUGIN_NAME = photogal.coplugin
TARGET_DIR = $(PLUGIN_NAME)/Contents/MacOS
TARGET = $(TARGET_DIR)/PhotogalCaptureOne

CFLAGS = -fobjc-arc -bundle \
	-arch arm64 -arch x86_64 \
	-mmacosx-version-min=14.0 \
	-F "$(CO_FRAMEWORKS)" \
	-framework Foundation \
	-framework AppKit \
	-framework CaptureOnePlugins \
	-Wl,-rpath,@loader_path/../../Frameworks \
	-Wl,-rpath,"$(CO_FRAMEWORKS)" \
	-Wl,-rpath,"$(CO_APP)" \
	-O2

all: $(TARGET)

$(TARGET): PhotogalCaptureOne.m
	@mkdir -p $(TARGET_DIR)
	@echo "Compiling universal PhotogalCaptureOne binary for arm64 + x86_64..."
	$(CC) $(CFLAGS) PhotogalCaptureOne.m -o $(TARGET)
	@echo "Build successful: $(TARGET)"

clean:
	rm -rf $(TARGET_DIR)/PhotogalCaptureOne $(PLUGIN_NAME).zip

package: $(TARGET)
	@echo "Packaging $(PLUGIN_NAME).zip..."
	zip -r -q $(PLUGIN_NAME).zip $(PLUGIN_NAME)
	@echo "Created $(PLUGIN_NAME).zip"

install: $(TARGET)
	@echo "Installing $(PLUGIN_NAME) into ~/Library/Application Support/Capture One/Plug-ins/..."
	@mkdir -p "$$HOME/Library/Application Support/Capture One/Plug-ins"
	@rm -rf "$$HOME/Library/Application Support/Capture One/Plug-ins/$(PLUGIN_NAME)"
	@cp -R $(PLUGIN_NAME) "$$HOME/Library/Application Support/Capture One/Plug-ins/"
	@echo "Plugin installed successfully! Restart Capture One to activate."

.PHONY: all clean package install

