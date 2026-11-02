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
@end

@interface COFileHandlingPluginTask : COPluginTask
- (instancetype)initWithAction:(COPluginAction *)action files:(NSArray<NSString *> *)files;
- (NSArray<NSString *> *)files;
@end

@interface COPluginActionResult : NSObject
- (void)setSuppressNotification:(BOOL)suppress;
@end

@interface COPluginActionPublishResult : COPluginActionResult
- (instancetype)initWithURL:(NSURL *)url message:(NSString *)message;
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

@interface PhotogalCaptureOne : COPluginBase <COPublishingPlugin, COOpenWithPlugin>
@end

@implementation PhotogalCaptureOne

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
    return @[task];
}

#pragma mark - Settings UI

- (NSArray<COSettingsElement *> *)settingsForAction:(COPluginAction *)action settings:(NSDictionary *)settings error:(NSError **)error {
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    
    NSString *savedUrl = [defs stringForKey:kPrefServerURL] ?: @"http://localhost:3000";
    NSString *savedToken = [defs stringForKey:kPrefAPIToken] ?: @"";
    NSString *savedGallery = [defs stringForKey:kPrefGalleryId] ?: @"__new__";

    // 1. Server URL setting
    COSettingsTextItem *urlItem = [[COSettingsTextItem alloc] initWithIdentifier:@"server_url" title:@"photogal Server URL"];
    [urlItem setValue:savedUrl];

    // 2. API Token setting (masked)
    COSettingsTextItem *tokenItem = [[COSettingsTextItem alloc] initWithIdentifier:@"api_token" title:@"API Token (pg_live_...)"];
    [tokenItem setSecure:YES];
    [tokenItem setValue:savedToken];

    // 3. Dynamic Gallery List option
    NSMutableArray<COSettingsListOption *> *options = [NSMutableArray array];
    [options addObject:[COSettingsListOption settingsListOptionWithValue:@"__new__" title:@"[ + Create New Gallery ]"]];

    if (savedUrl.length > 0 && savedToken.length > 0) {
        NSArray *fetchedGalleries = [self fetchGalleriesFromURL:savedUrl token:savedToken];
        for (NSDictionary *g in fetchedGalleries) {
            NSString *gId = g[@"id"];
            NSString *gTitle = g[@"title"] ?: @"Untitled";
            NSString *gDate = g[@"shoot_date"] ?: @"";
            NSString *display = [NSString stringWithFormat:@"%@ (%@)", gTitle, gDate];
            if (gId) {
                [options addObject:[COSettingsListOption settingsListOptionWithValue:gId title:display]];
            }
        }
    }

    COSettingsListItem *galleryChoice = [[COSettingsListItem alloc] initWithIdentifier:@"gallery_choice" title:@"Target Gallery"];
    [galleryChoice setOptions:options];
    [galleryChoice setValue:savedGallery];

    // 4. New gallery parameters (in case __new__ is selected)
    COSettingsTextItem *newTitle = [[COSettingsTextItem alloc] initWithIdentifier:@"new_title" title:@"New Gallery Title"];
    [newTitle setValue:@""];

    NSDateFormatter *df = [[NSDateFormatter alloc] init];
    df.dateFormat = @"yyyy-MM-dd";
    COSettingsTextItem *newDate = [[COSettingsTextItem alloc] initWithIdentifier:@"new_date" title:@"Shoot Date (YYYY-MM-DD)"];
    [newDate setValue:[df stringFromDate:[NSDate date]]];

    COSettingsTextItem *newPin = [[COSettingsTextItem alloc] initWithIdentifier:@"new_pin" title:@"PIN Code (4-12 digits, optional)"];
    [newPin setValue:@""];

    return @[urlItem, tokenItem, galleryChoice, newTitle, newDate, newPin];
}

- (BOOL)didUpdateValue:(id)value forSetting:(NSString *)setting action:(COPluginAction *)action settings:(NSDictionary *)settings callbackAction:(NSUInteger *)callback error:(NSError **)error {
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    if ([setting isEqualToString:@"server_url"] && [value isKindOfClass:[NSString class]]) {
        [defs setObject:value forKey:kPrefServerURL];
        [defs synchronize];
    } else if ([setting isEqualToString:@"api_token"] && [value isKindOfClass:[NSString class]]) {
        [defs setObject:value forKey:kPrefAPIToken];
        [defs synchronize];
    } else if ([setting isEqualToString:@"gallery_choice"] && [value isKindOfClass:[NSString class]]) {
        [defs setObject:value forKey:kPrefGalleryId];
        [defs synchronize];
    }
    return YES;
}

- (BOOL)validateSettings:(NSDictionary *)settings forAction:(COPluginAction *)action error:(NSError **)error {
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    NSString *url = settings[@"server_url"] ?: [defs stringForKey:kPrefServerURL];
    NSString *token = settings[@"api_token"] ?: [defs stringForKey:kPrefAPIToken];
    NSString *galleryChoice = settings[@"gallery_choice"] ?: [defs stringForKey:kPrefGalleryId];

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
        NSString *newTitle = settings[@"new_title"];
        NSString *newDate = settings[@"new_date"];
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

    return YES;
}

#pragma mark - Publishing Task Execution

- (COPluginActionPublishResult *)startPublishingTask:(COFileHandlingPluginTask *)task error:(NSError **)error progress:(void(^)(COPluginTask *task, uint64_t current, uint64_t total, NSString *message))progressBlock {
    NSUserDefaults *defs = [NSUserDefaults standardUserDefaults];
    NSString *serverUrl = [[defs stringForKey:kPrefServerURL] stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/ "]];
    NSString *apiToken = [defs stringForKey:kPrefAPIToken];
    NSString *galleryChoice = [defs stringForKey:kPrefGalleryId] ?: @"__new__";

    NSArray<NSString *> *files = [task files];
    if (!files || files.count == 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"photogal" code:400 userInfo:@{NSLocalizedDescriptionKey: @"No exported files found to upload."}];
        }
        return nil;
    }

    // Determine target gallery ID
    NSString *targetGalleryId = galleryChoice;
    if ([targetGalleryId isEqualToString:@"__new__"]) {
        NSString *newTitle = [defs stringForKey:@"photogal_new_title"] ?: @"Capture One Export";
        NSString *newDate = [defs stringForKey:@"photogal_new_date"] ?: @"2026-01-01";
        NSString *newPin = [defs stringForKey:@"photogal_new_pin"] ?: @"";

        targetGalleryId = [self createGalleryOnURL:serverUrl token:apiToken title:newTitle shootDate:newDate pinCode:newPin error:error];
        if (!targetGalleryId) {
            return nil;
        }
    }

    // Upload files batch by batch
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

    NSURL *galleryWebURL = [NSURL URLWithString:[NSString stringWithFormat:@"%@/admin/galleries/%@", serverUrl, targetGalleryId]];
    NSString *msg = [NSString stringWithFormat:@"Successfully uploaded %lu photos to photogal!", (unsigned long)totalFiles];

    return [[COPluginActionPublishResult alloc] initWithURL:galleryWebURL message:msg];
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

