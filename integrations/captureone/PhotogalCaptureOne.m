#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>

// Forward declarations of Capture One Plugin SDK classes & protocols
@interface COPluginBase : NSObject
@end

@interface COPluginAction : NSObject
- (instancetype)initWithDisplayName:(NSString *)displayName image:(NSImage *)image;
- (void)setIdentifier:(NSString *)identifier;
- (NSString *)identifier;
- (NSString *)displayName;
@end

@interface COPluginTask : NSObject
- (NSDictionary *)settings;
- (void)setSettings:(NSDictionary *)settings;
@end

@interface COFileHandlingPluginTask : COPluginTask
- (instancetype)initWithAction:(COPluginAction *)action files:(NSArray<NSString *> *)files;
- (NSArray<NSString *> *)files;
@end

@interface COPluginActionResult : NSObject
- (void)setSuppressNotification:(BOOL)suppress;
@end

@interface COPluginActionPublishResult : COPluginActionResult
- (instancetype)initWithURL:(id)url message:(NSString *)message;
- (id)URL;
@end

@interface COPluginActionOpenWithResult : COPluginActionResult
- (instancetype)initWithStatus:(NSUInteger)status;
@end

@interface COSettingsBase : NSObject
- (instancetype)initWithIdentifier:(NSString *)identifier title:(NSString *)title;
- (NSString *)identifier;
- (NSString *)title;
@end

@interface COSettingsElement : COSettingsBase
@end

@interface COSettingsItem : COSettingsElement
@end

@interface COSettingsTextItem : COSettingsItem
- (void)setValue:(NSString *)value;
- (NSString *)value;
- (void)setSecure:(BOOL)secure;
- (BOOL)secure;
@end

@interface COSettingsListOption : NSObject
+ (instancetype)settingsListOptionWithValue:(NSString *)value title:(NSString *)title;
- (NSString *)value;
- (NSString *)title;
@end

@interface COSettingsListItem : COSettingsItem
- (void)setOptions:(NSArray<COSettingsListOption *> *)options;
- (NSArray<COSettingsListOption *> *)options;
- (void)setValue:(NSString *)value;
- (NSString *)value;
@end

@interface COSettingsButtonItem : COSettingsItem
@end

// Protocol declarations
@protocol COFileHandling <NSObject>
- (NSArray<COFileHandlingPluginTask *> *)tasksForAction:(COPluginAction *)action forFiles:(NSArray<NSString *> *)files error:(NSError **)error;
@end

@protocol COActionSettings <NSObject>
@optional
- (NSArray<COSettingsElement *> *)settingsForAction:(COPluginAction *)action settings:(NSDictionary *)settings error:(NSError **)error;
- (BOOL)didUpdateValue:(id)value forSetting:(NSString *)setting action:(COPluginAction *)action settings:(NSDictionary *)settings callbackAction:(NSUInteger *)callback error:(NSError **)error;
- (BOOL)validateSettings:(NSDictionary *)settings forAction:(COPluginAction *)action error:(NSError **)error;
@end

@protocol COPublishingPlugin <COFileHandling, COActionSettings>
- (NSArray<COPluginAction *> *)publishingActionsFileCount:(NSUInteger)fileCount error:(NSError **)error;
- (COPluginActionPublishResult *)startPublishingTask:(COFileHandlingPluginTask *)task error:(NSError **)error progress:(void(^)(COPluginTask *task, uint64_t current, uint64_t total, NSString *message))progress;
@end

@protocol COOpenWithPlugin <COFileHandling, COActionSettings>
- (NSArray<COPluginAction *> *)openWithActionsWithFileInfo:(NSDictionary *)info pluginRole:(NSUInteger)role error:(NSError **)error;
- (COPluginActionOpenWithResult *)startOpenWithTask:(COFileHandlingPluginTask *)task error:(NSError **)error progress:(void(^)(COPluginTask *task, uint64_t current, uint64_t total, NSString *message))progress;
@end

static NSString *const kPrefServerURL = @"photogal_server_url";
static NSString *const kPrefAPIToken  = @"photogal_api_token";
static NSString *const kPrefGalleryId = @"photogal_target_gallery";
static NSString *const kPrefNewTitle  = @"photogal_new_title";
static NSString *const kPrefNewDate   = @"photogal_new_date";
static NSString *const kPrefNewPin    = @"photogal_new_pin";

static NSString *ExtractSettingString(id obj) {
    if (!obj) return nil;
    if ([obj isKindOfClass:[NSString class]]) {
        return (NSString *)obj;
    }
    if ([obj respondsToSelector:@selector(value)]) {
        id v = [obj performSelector:@selector(value)];
        if ([v isKindOfClass:[NSString class]]) return (NSString *)v;
    }
    if ([obj respondsToSelector:@selector(title)]) {
        id t = [obj performSelector:@selector(title)];
        if ([t isKindOfClass:[NSString class]]) return (NSString *)t;
    }
    return [obj description];
}

@interface PhotogalCaptureOne : COPluginBase <COPublishingPlugin, COOpenWithPlugin>

@property (nonatomic, copy) NSString *serverUrl;
@property (nonatomic, copy) NSString *apiToken;
@property (nonatomic, copy) NSString *galleryChoice;
@property (nonatomic, copy) NSString *targetGalleryTitle;
@property (nonatomic, copy) NSString *targetShootDate;
@property (nonatomic, copy) NSString *targetPinCode;

@end

@implementation PhotogalCaptureOne

- (instancetype)init {
    self = [super init];
    if (self) {
        NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
        _serverUrl = [[defs stringForKey:kPrefServerURL] ?: @"http://localhost:3000" copy];
        _apiToken = [[defs stringForKey:kPrefAPIToken] ?: @"" copy];
        _galleryChoice = [[defs stringForKey:kPrefGalleryId] ?: @"__new__" copy];
        _targetGalleryTitle = [[defs stringForKey:kPrefNewTitle] ?: @"" copy];

        NSDateFormatter *df = [[NSDateFormatter alloc] init];
        df.dateFormat = @"yyyy-MM-dd";
        _targetShootDate = [[defs stringForKey:kPrefNewDate] ?: [df stringFromDate:[NSDate date]] copy];
        _targetPinCode = [[defs stringForKey:kPrefNewPin] ?: @"" copy];
    }
    return self;
}

#pragma mark - Publish Actions

- (NSArray<COPluginAction *> *)publishingActionsFileCount:(NSUInteger)fileCount error:(NSError **)error {
    COPluginAction *action = [[COPluginAction alloc] initWithDisplayName:@"Upload to photogal" image:nil];
    [action setIdentifier:@"app.photogal.publish"];
    return @[action];
}

#pragma mark - Open With Actions

- (NSArray<COPluginAction *> *)openWithActionsWithFileInfo:(NSDictionary *)info pluginRole:(NSUInteger)role error:(NSError **)error {
    COPluginAction *action = [[COPluginAction alloc] initWithDisplayName:@"Upload to photogal" image:nil];
    [action setIdentifier:@"app.photogal.openwith"];
    return @[action];
}

#pragma mark - Task Preparation

- (NSArray<COFileHandlingPluginTask *> *)tasksForAction:(COPluginAction *)action forFiles:(NSArray<NSString *> *)files error:(NSError **)error {
    COFileHandlingPluginTask *task = [[COFileHandlingPluginTask alloc] initWithAction:action files:files];

    NSMutableDictionary *currentSettings = [NSMutableDictionary dictionary];
    if (self.serverUrl) currentSettings[@"server_url"] = self.serverUrl;
    if (self.apiToken) currentSettings[@"api_token"] = self.apiToken;
    if (self.galleryChoice) currentSettings[@"gallery_choice"] = self.galleryChoice;
    if (self.targetGalleryTitle) currentSettings[@"new_title"] = self.targetGalleryTitle;
    if (self.targetShootDate) currentSettings[@"new_date"] = self.targetShootDate;
    if (self.targetPinCode) currentSettings[@"new_pin"] = self.targetPinCode;

    if ([task respondsToSelector:@selector(setSettings:)]) {
        [task performSelector:@selector(setSettings:) withObject:currentSettings];
    }

    return @[task];
}

#pragma mark - Settings UI

- (NSArray<COSettingsElement *> *)settingsForAction:(COPluginAction *)action settings:(NSDictionary *)settings error:(NSError **)error {
    // 1. Sync state from settings dictionary if passed by Capture One
    if (settings && [settings isKindOfClass:[NSDictionary class]]) {
        if (settings[@"server_url"]) self.serverUrl = ExtractSettingString(settings[@"server_url"]);
        if (settings[@"api_token"]) self.apiToken = ExtractSettingString(settings[@"api_token"]);
        if (settings[@"gallery_choice"]) self.galleryChoice = ExtractSettingString(settings[@"gallery_choice"]);
        if (settings[@"new_title"]) self.targetGalleryTitle = ExtractSettingString(settings[@"new_title"]);
        if (settings[@"new_date"]) self.targetShootDate = ExtractSettingString(settings[@"new_date"]);
        if (settings[@"new_pin"]) self.targetPinCode = ExtractSettingString(settings[@"new_pin"]);
    }

    // 2. Fall back to NSUserDefaults if empty
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    if (!self.serverUrl || self.serverUrl.length == 0) self.serverUrl = [defs stringForKey:kPrefServerURL] ?: @"http://localhost:3000";
    if (!self.apiToken || self.apiToken.length == 0) self.apiToken = [defs stringForKey:kPrefAPIToken] ?: @"";
    if (!self.galleryChoice || self.galleryChoice.length == 0) self.galleryChoice = [defs stringForKey:kPrefGalleryId] ?: @"__new__";
    if (!self.targetGalleryTitle) self.targetGalleryTitle = [defs stringForKey:kPrefNewTitle] ?: @"";

    NSDateFormatter *df = [[NSDateFormatter alloc] init];
    df.dateFormat = @"yyyy-MM-dd";
    if (!self.targetShootDate || self.targetShootDate.length == 0) self.targetShootDate = [defs stringForKey:kPrefNewDate] ?: [df stringFromDate:[NSDate date]];
    if (!self.targetPinCode) self.targetPinCode = [defs stringForKey:kPrefNewPin] ?: @"";

    // 3. Server URL setting
    COSettingsTextItem *urlItem = [[COSettingsTextItem alloc] initWithIdentifier:@"server_url" title:@"photogal Server URL"];
    [urlItem setValue:self.serverUrl];

    // 4. API Token setting (masked)
    COSettingsTextItem *tokenItem = [[COSettingsTextItem alloc] initWithIdentifier:@"api_token" title:@"API Token (pg_live_...)"];
    [tokenItem setSecure:YES];
    [tokenItem setValue:self.apiToken];

    // 5. Dynamic Gallery List option
    NSMutableArray<COSettingsListOption *> *options = [NSMutableArray array];
    [options addObject:[COSettingsListOption settingsListOptionWithValue:@"__new__" title:@"[ + Create New Gallery ]"]];

    BOOL matchedExisting = NO;
    if (self.serverUrl.length > 0 && self.apiToken.length > 0) {
        NSArray *fetchedGalleries = [self fetchGalleriesFromURL:self.serverUrl token:self.apiToken];
        for (NSDictionary *g in fetchedGalleries) {
            NSString *gId = g[@"id"];
            NSString *gTitle = g[@"title"] ?: @"Untitled";
            NSString *gDate = g[@"shoot_date"] ?: @"";
            NSString *display = [NSString stringWithFormat:@"%@ (%@)", gTitle, gDate];
            if (gId) {
                [options addObject:[COSettingsListOption settingsListOptionWithValue:gId title:display]];
                if ([gId isEqualToString:self.galleryChoice]) {
                    matchedExisting = YES;
                }
            }
        }
    }

    COSettingsListItem *galleryChoice = [[COSettingsListItem alloc] initWithIdentifier:@"gallery_choice" title:@"Target Gallery"];
    [galleryChoice setOptions:options];

    // If previously selected gallery doesn't exist, stay with __new__ or first gallery
    if (!matchedExisting && ![self.galleryChoice isEqualToString:@"__new__"]) {
        if (options.count > 1) {
            self.galleryChoice = [options[1] value];
        } else {
            self.galleryChoice = @"__new__";
        }
    }
    [galleryChoice setValue:self.galleryChoice];

    // 6. New gallery parameters (in case __new__ is selected)
    COSettingsTextItem *newTitle = [[COSettingsTextItem alloc] initWithIdentifier:@"new_title" title:@"New Gallery Title"];
    [newTitle setValue:self.targetGalleryTitle ?: @""];

    COSettingsTextItem *newDate = [[COSettingsTextItem alloc] initWithIdentifier:@"new_date" title:@"Shoot Date (YYYY-MM-DD)"];
    [newDate setValue:self.targetShootDate ?: [df stringFromDate:[NSDate date]]];

    COSettingsTextItem *newPin = [[COSettingsTextItem alloc] initWithIdentifier:@"new_pin" title:@"PIN Code (4-12 digits, optional)"];
    [newPin setValue:self.targetPinCode ?: @""];

    return @[urlItem, tokenItem, galleryChoice, newTitle, newDate, newPin];
}

- (BOOL)didUpdateValue:(id)value forSetting:(NSString *)setting action:(COPluginAction *)action settings:(NSDictionary *)settings callbackAction:(NSUInteger *)callback error:(NSError **)error {
    NSString *strVal = ExtractSettingString(value);
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];

    if ([setting isEqualToString:@"server_url"]) {
        self.serverUrl = strVal;
        [defs setObject:strVal forKey:kPrefServerURL];
        [defs synchronize];
        if (callback) *callback = 1; // Request Capture One to reload settings list
    } else if ([setting isEqualToString:@"api_token"]) {
        self.apiToken = strVal;
        [defs setObject:strVal forKey:kPrefAPIToken];
        [defs synchronize];
        if (callback) *callback = 1; // Request Capture One to reload settings list
    } else if ([setting isEqualToString:@"gallery_choice"]) {
        self.galleryChoice = strVal;
        [defs setObject:strVal forKey:kPrefGalleryId];
        [defs synchronize];
    } else if ([setting isEqualToString:@"new_title"]) {
        self.targetGalleryTitle = strVal;
        [defs setObject:strVal forKey:kPrefNewTitle];
        [defs synchronize];
    } else if ([setting isEqualToString:@"new_date"]) {
        self.targetShootDate = strVal;
        [defs setObject:strVal forKey:kPrefNewDate];
        [defs synchronize];
    } else if ([setting isEqualToString:@"new_pin"]) {
        self.targetPinCode = strVal;
        [defs setObject:strVal forKey:kPrefNewPin];
        [defs synchronize];
    }

    return YES;
}

- (BOOL)validateSettings:(NSDictionary *)settings forAction:(COPluginAction *)action error:(NSError **)error {
    // Sync latest values from settings dictionary before validation
    if (settings && [settings isKindOfClass:[NSDictionary class]]) {
        if (settings[@"server_url"]) self.serverUrl = ExtractSettingString(settings[@"server_url"]);
        if (settings[@"api_token"]) self.apiToken = ExtractSettingString(settings[@"api_token"]);
        if (settings[@"gallery_choice"]) self.galleryChoice = ExtractSettingString(settings[@"gallery_choice"]);
        if (settings[@"new_title"]) self.targetGalleryTitle = ExtractSettingString(settings[@"new_title"]);
        if (settings[@"new_date"]) self.targetShootDate = ExtractSettingString(settings[@"new_date"]);
        if (settings[@"new_pin"]) self.targetPinCode = ExtractSettingString(settings[@"new_pin"]);
    }

    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    NSString *url = self.serverUrl ?: [defs stringForKey:kPrefServerURL];
    NSString *token = self.apiToken ?: [defs stringForKey:kPrefAPIToken];
    NSString *galleryChoice = self.galleryChoice ?: [defs stringForKey:kPrefGalleryId];

    if (!url || [url stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length == 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"Please provide the photogal Server URL in Settings."}];
        }
        return NO;
    }

    if (!token || [token stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length == 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"Please provide an API Token in Settings."}];
        }
        return NO;
    }

    if ([galleryChoice isEqualToString:@"__new__"]) {
        NSString *newTitle = self.targetGalleryTitle ?: [defs stringForKey:kPrefNewTitle];
        NSString *newDate = self.targetShootDate ?: [defs stringForKey:kPrefNewDate];
        if (!newTitle || [newTitle stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length == 0) {
            if (error) {
                *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"Please enter a New Gallery Title."}];
            }
            return NO;
        }
        if (!newDate || [newDate stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length == 0) {
            if (error) {
                *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"Please enter a Shoot Date (YYYY-MM-DD)."}];
            }
            return NO;
        }
    }

    // Persist validated settings
    if (self.serverUrl) [defs setObject:self.serverUrl forKey:kPrefServerURL];
    if (self.apiToken) [defs setObject:self.apiToken forKey:kPrefAPIToken];
    if (self.galleryChoice) [defs setObject:self.galleryChoice forKey:kPrefGalleryId];
    if (self.targetGalleryTitle) [defs setObject:self.targetGalleryTitle forKey:kPrefNewTitle];
    if (self.targetShootDate) [defs setObject:self.targetShootDate forKey:kPrefNewDate];
    if (self.targetPinCode) [defs setObject:self.targetPinCode forKey:kPrefNewPin];
    [defs synchronize];

    return YES;
}

#pragma mark - Publishing Task Execution

- (COPluginActionPublishResult *)startPublishingTask:(COFileHandlingPluginTask *)task error:(NSError **)error progress:(void(^)(COPluginTask *task, uint64_t current, uint64_t total, NSString *message))progressBlock {
    // 1. Read settings from task, with fallback to instance variables and NSUserDefaults
    NSDictionary *taskSettings = nil;
    if ([task respondsToSelector:@selector(settings)]) {
        taskSettings = [task performSelector:@selector(settings)];
    }

    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];

    NSString *serverUrl = ExtractSettingString(taskSettings[@"server_url"]) ?: self.serverUrl ?: [defs stringForKey:kPrefServerURL] ?: @"http://localhost:3000";
    serverUrl = [serverUrl stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/ "]];

    NSString *apiToken = ExtractSettingString(taskSettings[@"api_token"]) ?: self.apiToken ?: [defs stringForKey:kPrefAPIToken];
    NSString *galleryChoice = ExtractSettingString(taskSettings[@"gallery_choice"]) ?: self.galleryChoice ?: [defs stringForKey:kPrefGalleryId] ?: @"__new__";
    NSString *newTitle = ExtractSettingString(taskSettings[@"new_title"]) ?: self.targetGalleryTitle ?: [defs stringForKey:kPrefNewTitle];
    NSString *newDate = ExtractSettingString(taskSettings[@"new_date"]) ?: self.targetShootDate ?: [defs stringForKey:kPrefNewDate];
    NSString *newPin = ExtractSettingString(taskSettings[@"new_pin"]) ?: self.targetPinCode ?: [defs stringForKey:kPrefNewPin];

    NSArray<NSString *> *files = [task files];
    if (!files || files.count == 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"No exported files found to upload."}];
        }
        return nil;
    }

    // 2. Determine target gallery ID
    NSString *targetGalleryId = galleryChoice;
    if ([targetGalleryId isEqualToString:@"__new__"]) {
        NSString *titleToUse = (newTitle && [newTitle stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length > 0)
            ? [newTitle stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]
            : [NSString stringWithFormat:@"Capture One Export %@", [NSDateFormatter localizedStringFromDate:[NSDate date] dateStyle:NSDateFormatterShortStyle timeStyle:NSDateFormatterShortStyle]];

        NSDateFormatter *df = [[NSDateFormatter alloc] init];
        df.dateFormat = @"yyyy-MM-dd";
        NSString *dateToUse = (newDate && newDate.length >= 10) ? newDate : [df stringFromDate:[NSDate date]];

        targetGalleryId = [self createGalleryOnURL:serverUrl token:apiToken title:titleToUse shootDate:dateToUse pinCode:newPin error:error];
        if (!targetGalleryId) {
            return nil;
        }
    }

    // 3. Upload files batch by batch
    const NSUInteger batchSize = 10;
    NSUInteger totalFiles = files.count;
    NSUInteger uploadedCount = 0;

    for (NSUInteger i = 0; i < totalFiles; i += batchSize) {
        NSRange range = NSMakeRange(i, MIN(batchSize, totalFiles - i));
        NSArray<NSString *> *batch = [files subarrayWithRange:range];

        if (progressBlock) {
            NSString *msg = [NSString stringWithFormat:@"Uploading photo %lu of %lu to photogal...", (unsigned long)(uploadedCount + 1), (unsigned long)totalFiles];
            progressBlock(task, uploadedCount, totalFiles, msg);
        }

        BOOL success = [self uploadBatch:batch toGallery:targetGalleryId serverUrl:serverUrl token:apiToken error:error];
        if (!success) {
            return nil;
        }
        uploadedCount += batch.count;
    }

    if (progressBlock) {
        progressBlock(task, totalFiles, totalFiles, @"Upload complete!");
    }

    NSString *galleryWebURLString = [NSString stringWithFormat:@"%@/admin/galleries/%@", serverUrl, targetGalleryId];
    NSString *msg = [NSString stringWithFormat:@"Successfully uploaded %lu photos to photogal!", (unsigned long)totalFiles];

    // NOTE: Capture One expects an NSString for the URL parameter, calling [URL length].
    // Passing an NSURL causes unrecognized selector [NSURL length] and crashes Capture One!
    COPluginActionPublishResult *result = [[COPluginActionPublishResult alloc] initWithURL:(id)galleryWebURLString message:msg];
    return result;
}

#pragma mark - Open With Task Execution

- (COPluginActionOpenWithResult *)startOpenWithTask:(COFileHandlingPluginTask *)task error:(NSError **)error progress:(void(^)(COPluginTask *task, uint64_t current, uint64_t total, NSString *message))progressBlock {
    COPluginActionPublishResult *res = [self startPublishingTask:task error:error progress:progressBlock];
    if (!res) {
        return nil;
    }
    return [[COPluginActionOpenWithResult alloc] initWithStatus:0];
}

#pragma mark - Networking Helpers

- (NSArray *)fetchGalleriesFromURL:(NSString *)serverUrl token:(NSString *)token {
    NSString *urlString = [NSString stringWithFormat:@"%@/api/admin/galleries", [serverUrl stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/ "]]];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
    [req setHTTPMethod:@"GET"];
    [req setValue:[NSString stringWithFormat:@"Bearer %@", token] forHTTPHeaderField:@"Authorization"];
    [req setTimeoutInterval:5.0];

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSArray *galleries = @[];

    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        if (!err && data) {
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if ([json isKindOfClass:[NSDictionary class]] && [json[@"galleries"] isKindOfClass:[NSArray class]]) {
                galleries = json[@"galleries"];
            }
        }
        dispatch_semaphore_signal(sem);
    }] resume];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5.0 * NSEC_PER_SEC)));
    return galleries;
}

- (NSString *)createGalleryOnURL:(NSString *)serverUrl token:(NSString *)token title:(NSString *)title shootDate:(NSString *)date pinCode:(NSString *)pin error:(NSError **)outError {
    NSString *urlString = [NSString stringWithFormat:@"%@/api/admin/galleries", serverUrl];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
    [req setHTTPMethod:@"POST"];
    [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    [req setValue:[NSString stringWithFormat:@"Bearer %@", token] forHTTPHeaderField:@"Authorization"];

    NSMutableDictionary *payload = [@{
        @"title": title,
        @"shoot_date": date
    } mutableCopy];
    if (pin && pin.length >= 4) {
        payload[@"pin_code"] = pin;
    }

    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSString *newId = nil;
    __block NSError *netError = nil;

    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        if (err) {
            netError = err;
        } else if (data) {
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if ([json isKindOfClass:[NSDictionary class]] && [json[@"gallery"] isKindOfClass:[NSDictionary class]]) {
                newId = json[@"gallery"][@"id"];
            } else if ([json isKindOfClass:[NSDictionary class]] && json[@"error"]) {
                netError = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: json[@"error"]}];
            }
        }
        dispatch_semaphore_signal(sem);
    }] resume];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15.0 * NSEC_PER_SEC)));

    if (!newId) {
        if (outError) {
            *outError = netError ?: [NSError errorWithDomain:@"photogal" code:500 userInfo:@{NSLocalizedDescriptionKey: @"Failed to create gallery on photogal server."}];
        }
        return nil;
    }
    return newId;
}

- (BOOL)uploadBatch:(NSArray<NSString *> *)filePaths toGallery:(NSString *)galleryId serverUrl:(NSString *)serverUrl token:(NSString *)token error:(NSError **)outError {
    NSString *urlString = [NSString stringWithFormat:@"%@/api/admin/galleries/%@/upload", serverUrl, galleryId];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
    [req setHTTPMethod:@"POST"];
    [req setValue:[NSString stringWithFormat:@"Bearer %@", token] forHTTPHeaderField:@"Authorization"];

    NSString *boundary = [NSString stringWithFormat:@"Boundary-%@", [[NSUUID UUID] UUIDString]];
    [req setValue:[NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary] forHTTPHeaderField:@"Content-Type"];

    NSMutableData *body = [NSMutableData data];

    for (NSString *path in filePaths) {
        NSData *fileData = [NSData dataWithContentsOfFile:path];
        if (!fileData) continue;

        NSString *filename = [path lastPathComponent];
        [body appendData:[[NSString stringWithFormat:@"--%@\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
        [body appendData:[[NSString stringWithFormat:@"Content-Disposition: form-data; name=\"files\"; filename=\"%@\"\r\n", filename] dataUsingEncoding:NSUTF8StringEncoding]];
        [body appendData:[@"Content-Type: image/jpeg\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding]];
        [body appendData:fileData];
        [body appendData:[@"\r\n" dataUsingEncoding:NSUTF8StringEncoding]];
    }

    [body appendData:[[NSString stringWithFormat:@"--%@--\r\n", boundary] dataUsingEncoding:NSUTF8StringEncoding]];
    req.HTTPBody = body;

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL uploadSuccess = NO;
    __block NSError *uploadError = nil;

    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        NSHTTPURLResponse *httpRes = (NSHTTPURLResponse *)res;
        if (err) {
            uploadError = err;
        } else if (httpRes.statusCode >= 200 && httpRes.statusCode < 300) {
            uploadSuccess = YES;
        } else {
            NSString *errMsg = @"Server returned an upload error.";
            if (data) {
                NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                if (json[@"error"]) errMsg = json[@"error"];
            }
            uploadError = [NSError errorWithDomain:@"photogal" code:httpRes.statusCode userInfo:@{NSLocalizedDescriptionKey: errMsg}];
        }
        dispatch_semaphore_signal(sem);
    }] resume];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(120.0 * NSEC_PER_SEC)));

    if (!uploadSuccess) {
        if (outError) {
            *outError = uploadError ?: [NSError errorWithDomain:@"photogal" code:500 userInfo:@{NSLocalizedDescriptionKey: @"Upload timed out or failed."}];
        }
        return NO;
    }
    return YES;
}

@end
